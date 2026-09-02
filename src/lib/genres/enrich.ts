import { filterTags } from './filter';
import type { FacetedTags, Tag } from './types';

export interface EnrichInput {
  eventId: string;
  artistId: string;
  name: string;
}

export type EnrichOutcome =
  | { status: 'resolved'; genres: FacetedTags; resolvedVia: 'mbid' | 'alias' | 'spotify_name' | 'none' }
  | { status: 'failed'; reason: string };

export interface EnrichDeps {
  mbidForSpotifyArtist: (spotifyArtistId: string) => Promise<string | null>;
  englishAliasFor: (mbid: string) => Promise<string | null>;
  topTagsByMbid: (mbid: string) => Promise<Tag[]>;
  topTagsByName: (name: string) => Promise<Tag[]>;
  writeGenres: (row: ArtistGenresRow) => Promise<{ rowCount: number }>;
}

// `FacetedTags` is what `filterTags` returns; `ArtistGenresRow` is what the table takes. They
// are deliberately not the same type -- the table spreads the three facets across three jsonb
// columns. `enrich.ts` spreads it: `{ ...faceted }` lands the three keys correctly, but it is
// written out explicitly so a fourth facet added later fails to compile rather than silently
// vanishing.
//
// DEVIATION from the plan's verbatim interface: `genres`, `origins`, `eras`, `resolved_via` and
// `fetched_at` are optional here, not required. A failed attempt has no facets to report and
// must not overwrite a previously-cached resolved row's genres with an empty `{}` on retry --
// the write for a failed attempt omits those keys entirely rather than sending zeroed-out
// values. The plan's pasted type has them all required, which cannot represent that omission;
// the "a failed WRITE surfaces as failed" test (and, more directly, its sibling assertion that
// `written.genres` is `undefined` on the error path) only holds if the row genuinely lacks the
// key, not if it is set to `{}`.
export interface ArtistGenresRow {
  event_id: string;
  spotify_artist_id: string;
  artist_name: string; // NOT NULL in the table, no default
  musicbrainz_id: string | null; // cached independently of the tags (§2.10),
  musicbrainz_name: string | null; // so a Last.fm miss does not re-resolve the MBID
  status: 'resolved' | 'failed';
  genres?: Record<string, number>; // THREE separate jsonb columns --
  origins?: Record<string, number>; // FacetedTags is the in-memory shape,
  eras?: Record<string, number>; // never the row shape
  resolved_via?: 'mbid' | 'alias' | 'spotify_name' | 'none' | null;
  attempts: number;
  last_attempt_at: string;
  fetched_at?: string | null;
}

function baseRow(input: EnrichInput, mbid: string | null, mbName: string | null): Pick<
  ArtistGenresRow,
  'event_id' | 'spotify_artist_id' | 'artist_name' | 'musicbrainz_id' | 'musicbrainz_name' | 'attempts' | 'last_attempt_at'
> {
  return {
    event_id: input.eventId,
    spotify_artist_id: input.artistId,
    artist_name: input.name,
    musicbrainz_id: mbid,
    musicbrainz_name: mbName,
    attempts: 1,
    last_attempt_at: new Date().toISOString(),
  };
}

/**
 * Walks one artist up the four-rung enrichment ladder (§2.10):
 *
 *   1. MBID from the Spotify id -> tags by MBID             -> resolvedVia 'mbid'
 *   2. same MBID -> English alias -> tags by that name       -> resolvedVia 'alias'
 *   3. tags by the Spotify name                               -> resolvedVia 'spotify_name'
 *   4. nothing worked -> resolved with {} genres              -> resolvedVia 'none'
 *
 * The three-way classification is the point: a parsed success with no tags, or Last.fm's
 * explicit "not found", is EMPTY and falls through to the next rung; anything thrown (a
 * `GenreError` of any kind, or anything else) is an ERROR and abandons the ladder outright,
 * default-deny. An empty result at every rung is still a successful `resolved` outcome with
 * `{}` genres, not a failure -- there is nothing more to try, not something that went wrong.
 *
 * The MBID and (if found) the English alias are cached on every path, including the error
 * path, so a Last.fm hiccup does not force re-resolving MusicBrainz on the next attempt.
 */
export async function enrichArtist(input: EnrichInput, deps: EnrichDeps): Promise<EnrichOutcome> {
  let mbid: string | null = null;
  let mbName: string | null = null;

  try {
    mbid = await deps.mbidForSpotifyArtist(input.artistId);

    if (mbid !== null) {
      const tagsByMbid = await deps.topTagsByMbid(mbid);
      if (tagsByMbid.length > 0) {
        return await resolveAndWrite('mbid', tagsByMbid);
      }

      mbName = await deps.englishAliasFor(mbid);
      if (mbName !== null) {
        const tagsByAlias = await deps.topTagsByName(mbName);
        if (tagsByAlias.length > 0) {
          return await resolveAndWrite('alias', tagsByAlias);
        }
      }
    }

    const tagsByName = await deps.topTagsByName(input.name);
    if (tagsByName.length > 0) {
      return await resolveAndWrite('spotify_name', tagsByName);
    }

    return await resolveAndWrite('none', []);
  } catch (err) {
    // Default-deny: ANY throw here -- a GenreError of any kind, or anything
    // unrecognised -- abandons the ladder. Never reinterpreted as "empty".
    await deps.writeGenres({
      ...baseRow(input, mbid, mbName),
      status: 'failed',
    });
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }

  async function resolveAndWrite(
    via: 'mbid' | 'alias' | 'spotify_name' | 'none',
    tags: Tag[],
  ): Promise<EnrichOutcome> {
    const faceted = filterTags(tags, input.name, mbName);
    const { rowCount } = await deps.writeGenres({
      ...baseRow(input, mbid, mbName),
      status: 'resolved',
      ...faceted,
      resolved_via: via,
      fetched_at: new Date().toISOString(),
    });

    if (rowCount === 0) {
      // The write's own RLS policy admitted no rows -- a silent no-op that
      // must not be reported to the caller as a success (§ the write's own
      // failure mode this project has already hit once).
      return { status: 'failed', reason: 'genre write affected no rows' };
    }

    return { status: 'resolved', genres: faceted, resolvedVia: via };
  }
}
