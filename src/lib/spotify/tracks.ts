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

function toResolvedTrack(raw: RawTrack): ResolvedTrack {
  return {
    id: raw.id,
    title: raw.name,
    artist: raw.artists[0]?.name ?? '',
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
 * A single track's failure (a transient 429, a 5xx, a 404) is swallowed and
 * that track is simply left unresolved for this cycle rather than failing
 * the whole batch -- one bad id must not stop every OTHER pending track
 * from resolving.
 */
export async function resolveTracks(
  ids: string[],
  { max = 10, concurrency = 5 }: ResolveTracksOptions = {},
): Promise<ResolvedTrack[]> {
  const targets = ids.slice(0, max);
  const results: (ResolvedTrack | null)[] = new Array(targets.length).fill(null);

  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= targets.length) return;
      try {
        results[i] = await getTrack(targets[i]);
      } catch {
        results[i] = null;
      }
    }
  }

  const workerCount = Math.min(concurrency, targets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results.filter((r): r is ResolvedTrack => r !== null);
}
