import 'server-only';

import { spotifyFetch, SpotifyError } from './client';
import { appToken } from './appToken';
import { pickArtwork, type RawImage } from './images';

/* ---------------------------------------------------------------------------
   Artwork for rows we already have Spotify IDs for.

   The event page stores ids, never image URLs (`event_must_play.spotify_track_id`,
   `event_blocklist.spotify_id`). That is deliberate: a Spotify image URL is not
   promised to stay valid, so a column holding one goes stale silently and every
   old row ends up with a broken image. Resolving by id at read time can't go
   stale, at the cost of a round trip.

   ONE REQUEST PER ID, not a batch. `GET /v1/tracks?ids=` and
   `GET /v1/artists?ids=` BOTH return a bare 403 for this app's client
   credentials, while `GET /v1/tracks/{id}` and `GET /v1/artists/{id}` both
   return 200 with the same token -- verified live on 2026-09-06 against the
   real API, not read off Spotify's reference docs. tracks.ts records the track
   half of this (found the same way, after a reviewer's "documentation, not a
   live call" flag was overruled once); the artist half was confirmed at the
   same time. Do not "optimise" this into a batch call: it does not fail
   loudly, it 403s and every image disappears.

   Because it is one request per id, the cost is bounded three ways: ids are
   de-duplicated, capped at MAX_IDS, and run at CONCURRENCY at a time. The
   responses are also served from Next's Data Cache for a day -- artwork does
   not change, and this page reloads on every list edit.
   --------------------------------------------------------------------------- */

/**
 * Keyed `track:<id>` / `artist:<id>`, never the bare id.
 *
 * Spotify ids are only unique WITHIN a type, so a bare-id map would be
 * ambiguous the day a track and an artist share one. Build a key with
 * `artworkKey` (in detailTypes.ts, so Client Components can use it without
 * importing this server-only module).
 */
export type ArtworkById = Record<string, string>;

export type ArtworkKind = 'track' | 'artist';

/**
 * Ceiling on Spotify calls for one page render. A realistic event has well
 * under this many rows; the cap exists so a pathological list can't turn one
 * page load into a hundred third-party round trips. Rows beyond it simply
 * render without a thumbnail, which is the same as the pre-picker rows
 * already do.
 */
const MAX_IDS = 24;
const CONCURRENCY = 3;

/**
 * How long to stop asking for artwork entirely after Spotify rate-limits us.
 *
 * `/tracks/{id}` and `/artists/{id}` share a quota that `/search` does NOT --
 * observed 2026-09-06, when both id endpoints answered 429 with
 * `Retry-After: 649` while `/search` still returned 200 with the same token.
 * So exhausting this quota costs thumbnails and leaves the picker (a core
 * feature) working, which is the right way round -- but only if we stop
 * asking. Next's Data Cache stores 200s ONLY, so without this every throttled
 * id is re-requested on every single page load, which is what dug the hole to
 * eleven minutes deep in the first place.
 *
 * Deliberately a flat cooldown rather than the real `Retry-After`: a value
 * that long is a symptom of repeated hammering, and a minute of silence is
 * enough to stop contributing to it. Module-level, so on Vercel each
 * serverless instance keeps its own -- same accepted trade-off appToken makes.
 */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

let throttledUntil = 0;

/** A day. Artwork does not change; this page re-renders on every list edit. */
const REVALIDATE_SECONDS = 86_400;

interface RawTrackResponse {
  album?: { images?: RawImage[] };
}

interface RawArtistResponse {
  images?: RawImage[];
}

interface Target {
  kind: ArtworkKind;
  id: string;
}

async function fetchArtwork(target: Target, token: string): Promise<string | null> {
  if (target.kind === 'track') {
    const json = await spotifyFetch<RawTrackResponse>(`/tracks/${target.id}`, token, {
      // spotifyFetch defaults to 'no-store'; artwork is the one thing this app
      // reads from Spotify that is safe to cache, so it opts in explicitly.
      // `revalidate` alone would be ignored -- Next treats
      // `{ revalidate, cache: 'no-store' }` as contradictory and drops both.
      cache: 'force-cache',
      next: { revalidate: REVALIDATE_SECONDS },
    });
    return pickArtwork(json.album?.images);
  }
  const json = await spotifyFetch<RawArtistResponse>(`/artists/${target.id}`, token, {
    cache: 'force-cache',
    next: { revalidate: REVALIDATE_SECONDS },
  });
  return pickArtwork(json.images);
}

export interface ResolveArtworkInput {
  trackIds: (string | null | undefined)[];
  artistIds: (string | null | undefined)[];
}

/**
 * Best-effort. EVERY failure path returns a map missing that entry rather than
 * throwing: a thumbnail is decoration, and an event page that 500s because
 * Spotify rate-limited a picture is a far worse outcome than a page with a
 * blank square. That covers a missing credential, a 429, a 404 on a deleted
 * track, and a network failure alike -- callers get `{}` at worst.
 */
export async function resolveArtwork({ trackIds, artistIds }: ResolveArtworkInput): Promise<ArtworkById> {
  const targets: Target[] = [];
  const seen = new Set<string>();

  function add(kind: ArtworkKind, ids: (string | null | undefined)[]) {
    for (const id of ids) {
      if (!id) continue;
      const key = `${kind}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ kind, id });
    }
  }

  add('track', trackIds);
  add('artist', artistIds);

  const bounded = targets.slice(0, MAX_IDS);
  if (bounded.length === 0) return {};

  // Still cooling down from a 429. Every row renders without a thumbnail, the
  // same as any other failure -- and, crucially, we make no request at all
  // rather than spending the page's time proving we are still throttled.
  if (Date.now() < throttledUntil) return {};


  let token: string;
  try {
    token = await appToken();
  } catch {
    // No Spotify credentials configured, or the token endpoint is down. Every
    // row renders without a thumbnail; nothing else on the page is affected.
    return {};
  }

  const out: ArtworkById = {};
  let next = 0;
  let rateLimited = false;

  async function worker() {
    for (;;) {
      // Abandon the rest of this render's ids the moment Spotify says we are
      // over quota. Carrying on would make ~20 more requests that are all
      // certain to 429, each one deepening the throttle and each one costing
      // spotifyFetch's retry sleep -- so it would both slow this page render
      // AND make the next one worse.
      if (rateLimited) return;

      const i = next;
      next += 1;
      if (i >= bounded.length) return;
      const target = bounded[i];
      try {
        const url = await fetchArtwork(target, token);
        if (url) out[`${target.kind}:${target.id}`] = url;
      } catch (err) {
        // One id failing must not cost the other rows their thumbnails --
        // unless it failed because we are over quota, in which case every
        // other id would fail too.
        if (err instanceof SpotifyError && err.kind === 'rate_limited') {
          rateLimited = true;
          throttledUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, bounded.length) }, () => worker()));

  return out;
}
