import 'server-only';

import { spotifyFetch, SpotifyError } from './client';
import { appToken } from './appToken';

export interface ResolvedTrack {
  id: string;
  title: string;
  /** First artist, for display only (design §4.3). */
  artist: string;
  /** Every artist on the track -- what the blocklist and artist-repeat terms match against. */
  artists: { id: string; name: string }[];
}

interface RawArtistRef {
  id: string;
  name: string;
}

interface RawTrack {
  id: string;
  name: string;
  artists: RawArtistRef[];
}

/**
 * G4: `spotify_tracks.artist_len` (a database CHECK) requires 1-200 chars,
 * so `raw.artists[0]?.name ?? ''` would fail the upsert outright if Spotify
 * ever answered with a zero-artist track -- and a failed upsert here is
 * exactly the starvation `UNRESOLVABLE_TRACK_ARTIST` (`src/lib/live/liveTypes.ts`)
 * was introduced to avoid, just via a different path (a CHECK violation
 * instead of a 404). This module is a lower-level Spotify client and
 * `liveTypes.ts` is a live-event-domain module one layer up, so a local
 * fallback here (rather than importing the domain sentinel into the client)
 * keeps the dependency direction pointing the right way. It only needs to be
 * a non-empty display placeholder, not the sentinel itself -- a zero-artist
 * response is a shape Spotify returned, not the same case as a 404, and
 * conflating them would make a genuinely-found-but-artistless track render
 * with the "Spotify has no such track" strings.
 */
const UNKNOWN_ARTIST_PLACEHOLDER = 'Unknown artist';

function toResolvedTrack(raw: RawTrack): ResolvedTrack {
  return {
    id: raw.id,
    title: raw.name,
    artist: raw.artists[0]?.name ?? UNKNOWN_ARTIST_PLACEHOLDER,
    artists: raw.artists.map((a) => ({ id: a.id, name: a.name })),
  };
}

/**
 * ONE track, `GET /tracks/{id}` (design §4.3, §8.1 -- corrected 2026-09-05).
 *
 * The batched form of this section, `GET /tracks?ids=`, was specified on
 * Spotify's own reference docs and never called live. A real call against
 * this app's credentials returned a bare 403 on the batch endpoint while
 * this singular endpoint and `/search` both returned 200 with the same
 * token -- verified behaviour, three retries, with and without `market`.
 * The CAUSE (an API access tier this app has not been granted) is NOT
 * verified; only the observed 403-vs-200 split is. A reviewer had flagged
 * the batch claim as "documentation, not a live call" and it stood anyway --
 * this is the corrected version, closed by actually calling it.
 *
 * Returns null for a 404 (no such track) rather than throwing -- the
 * caller's job is to decide what "still doesn't exist" means for a queue
 * row, not this function's.
 */
export async function getTrack(id: string): Promise<ResolvedTrack | null> {
  const token = await appToken();
  try {
    const json = await spotifyFetch<RawTrack>(`/tracks/${id}`, token);
    return toResolvedTrack(json);
  } catch (err) {
    if (err instanceof SpotifyError && err.status === 404) return null;
    throw err;
  }
}

export interface ResolveTracksOptions {
  /** At most this many ids are attempted per call. */
  max?: number;
  /** At most this many requests in flight at once. */
  concurrency?: number;
}

export interface ResolveTracksResult {
  resolved: ResolvedTrack[];
  /**
   * Ids Spotify answered with a 404 -- not a transient failure, an ANSWER:
   * the id is not a real track. The caller (the poll route, F1) must record
   * this permanently so the id stops being re-attempted forever; a transient
   * failure (429/5xx, swallowed below same as before) is left off both
   * arrays entirely and simply retried on the next poll.
   */
  notFound: string[];
}

/**
 * What the DJ's poll calls (design §8.1, Task 15) -- bounded the same way
 * §6.2b already bounds artist enrichment, and for the identical reason: an
 * unbounded third-party fan-out inside a request that repeats every few
 * seconds is how polls stack. Steady state is 0-2 unresolved tracks per
 * poll (a guest suggests one song at a time); the bound only matters for a
 * cold start, where it costs a couple of extra poll cycles rather than one
 * round trip -- during which every song is still ranked on its requester
 * count and still playable, never dropped and never silently unblocked.
 *
 * A transient failure (a 429, a 5xx) is swallowed and that track is simply
 * left off both `resolved` and `notFound` for this cycle rather than failing
 * the whole batch -- one bad id must not stop every OTHER pending track from
 * resolving, and a transient failure resolves on its own on a later poll.
 *
 * A 404 is different in kind, not degree (F1): it is Spotify's answer that
 * the id is not a real track, never going to change on retry. It is
 * reported back via `notFound` so the caller can record it permanently --
 * swallowing it the same way as a transient failure was the bug: it never
 * left the caller's "still needs resolving" set, so it (and anything queued
 * behind it once the caller only resolves a bounded number per poll)
 * retried forever and never let up a resolution slot.
 */
export async function resolveTracks(
  ids: string[],
  { max = 10, concurrency = 5 }: ResolveTracksOptions = {},
): Promise<ResolveTracksResult> {
  const targets = ids.slice(0, max);
  type Outcome = { kind: 'resolved'; track: ResolvedTrack } | { kind: 'not-found' } | { kind: 'transient-error' };
  const outcomes: (Outcome | null)[] = new Array(targets.length).fill(null);

  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= targets.length) return;
      try {
        const track = await getTrack(targets[i]);
        outcomes[i] = track ? { kind: 'resolved', track } : { kind: 'not-found' };
      } catch {
        outcomes[i] = { kind: 'transient-error' };
      }
    }
  }

  const workerCount = Math.min(concurrency, targets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const resolved: ResolvedTrack[] = [];
  const notFound: string[] = [];
  outcomes.forEach((outcome, i) => {
    if (outcome === null || outcome.kind === 'transient-error') return;
    if (outcome.kind === 'resolved') resolved.push(outcome.track);
    else notFound.push(targets[i]);
  });

  return { resolved, notFound };
}
