import 'server-only';
import { GenreError, type GenreErrorKind } from './errors';
import type { Tag } from './types';

const BASE = 'https://ws.audioscrobbler.com/2.0/';

/** Transient network/5xx failures get one retry -- the same generic shape
 *  task 3 established for MusicBrainz. Unlike MusicBrainz, Last.fm has no
 *  documented rate limit this task was asked to pace against, so no fixed
 *  backoff floor is invented here; a short pause before the single retry is
 *  enough to ride out a blip without guessing at a policy nobody specified. */
const BACKOFF_MS = 500;

/**
 * Default-deny: only a real HTTP 429 gets its own kind. Everything else --
 * 5xx, malformed JSON, a 200 missing `toptags`, and every Last.fm `error`
 * code except 6 -- is 'unavailable'. Adding a new kind means adding a case,
 * not widening the default.
 */
function classify(status: number): GenreErrorKind {
  switch (true) {
    case status === 429:
      return 'rate_limited';
    default:
      return 'unavailable';
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The wire shape. Last.fm sends `count` as a STRING -- coerced to `LastfmTag`
 *  before this module returns anything, so nothing downstream sees this type. */
interface RawTag {
  name: string;
  count: string | number;
}

interface LastfmTopTagsBody {
  toptags?: { tag?: RawTag[] };
  error?: number;
  message?: string;
}

/**
 * Fetches Last.fm's `artist.gettoptags` for one MBID, returning its parsed
 * JSON body. Never returns null -- an error and an empty answer are
 * different channels; the caller (topTagsByMbid) decides what "empty" means.
 *
 * Never echoes the response body or the request URL into an error message --
 * the API key is a query parameter on that URL.
 */
async function lastfmFetch(url: URL): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      if (attempt === 0) {
        await wait(BACKOFF_MS);
        continue;
      }
      throw new GenreError('network', 'lastfm network error');
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new GenreError('unavailable', 'lastfm malformed json');
      }
    }

    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await wait(BACKOFF_MS);
      continue;
    }
    throw new GenreError(classify(res.status), `lastfm ${res.status}`);
  }
  // Unreachable -- the loop above always returns or throws within two
  // attempts -- but keeps the function's return type honest for tsc.
  throw new GenreError('unavailable', 'lastfm retry exhausted');
}

/**
 * Parses a `lastfmFetch` body shared by every `artist.gettoptags` caller,
 * regardless of whether the lookup was by MBID or by name.
 *
 * Last.fm reports failure INSIDE a 200 response: `{ error, message }`.
 * Error 6 ("not found") is a real answer -- the artist genuinely is not in
 * Last.fm's catalogue -- so it resolves to `[]`, not a thrown error. Every
 * other `error` code, and a 200 missing the `toptags` key entirely, means
 * Last.fm did not do the lookup we asked for and is 'unavailable'.
 */
function parseTopTags(body: LastfmTopTagsBody): Tag[] {
  if (typeof body.error === 'number') {
    if (body.error === 6) {
      return [];
    }
    throw new GenreError('unavailable', `lastfm error ${body.error}`);
  }

  if (!body.toptags || !Array.isArray(body.toptags.tag)) {
    // A 200 with no `toptags` key is not a real answer -- Last.fm did not
    // do the lookup we asked for. That is an error, not "no tags".
    throw new GenreError('unavailable', 'lastfm response missing toptags');
  }

  // Last.fm returns `count` as a STRING on the wire. Coerce here so the Tag
  // contract holds for every consumer -- filterTags SUMS counts when merging
  // aliases, and "52" + "3" is "523", not 55. Number(undefined) is NaN, so
  // default the missing case.
  return body.toptags.tag.map((t) => ({
    name: String(t.name),
    count: Number(t.count ?? 0),
  }));
}

function requireApiKey(): string {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    throw new GenreError('unavailable', 'lastfm api key not configured');
  }
  return apiKey;
}

/**
 * Resolves an MBID to Last.fm's top tags for that artist. Queries by MBID
 * only, never by name -- name lookups are ambiguous across artists sharing a
 * name and are not what this ladder step is for.
 */
export async function topTagsByMbid(mbid: string): Promise<Tag[]> {
  const apiKey = requireApiKey();

  const url = new URL(BASE);
  url.searchParams.set('method', 'artist.gettoptags');
  url.searchParams.set('mbid', mbid);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');

  const body = (await lastfmFetch(url)) as LastfmTopTagsBody;
  return parseTopTags(body);
}

/**
 * Fallback rung: resolves an artist NAME to Last.fm's top tags. Less
 * trustworthy than `topTagsByMbid` -- an ambiguous name can return a
 * completely different artist's tags (design §2.10) -- so it carries two
 * defenses `topTagsByMbid` doesn't need:
 *
 *  - `autocorrect=0`: Last.fm's `autocorrect=1` silently maps an
 *    unrecognized name onto its own "best guess" match, which is the same
 *    wrong-artist failure mode arriving through a different door. An
 *    unresolvable name must come back as a genuine miss, not a confident
 *    wrong answer.
 *  - `URLSearchParams` encodes the name correctly for both `&` (which would
 *    otherwise truncate the query string) and non-ASCII scripts (Hebrew
 *    artist names are a real case in this product).
 */
export async function topTagsByName(name: string): Promise<Tag[]> {
  const apiKey = requireApiKey();

  const url = new URL(BASE);
  url.searchParams.set('method', 'artist.gettoptags');
  url.searchParams.set('artist', name);
  url.searchParams.set('autocorrect', '0');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');

  const body = (await lastfmFetch(url)) as LastfmTopTagsBody;
  return parseTopTags(body);
}
