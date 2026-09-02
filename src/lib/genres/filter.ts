import { facetOf, normaliseGenre } from './vocabulary';
import type { FacetedTags, Tag } from './types';

/** Turns raw Last.fm tags into the three facets the app cares about,
 *  dropping folksonomy noise ("spotify", "seen live", ...) and the artist's
 *  own name (Last.fm frequently tags an artist with their own name).
 *
 *  Never restates the vocabulary -- `facetOf`/`normaliseGenre` from
 *  vocabulary.ts are the single source of truth for what bucket a token
 *  belongs to, and what a token's canonical spelling is.
 *
 *  An unrecognised token (facetOf returns null) is dropped, not guessed at:
 *  the empty result for an artist with no bucketable tags is the correct,
 *  successful answer -- see the "Eyal Golan case" in filter.test.ts.
 */
export function filterTags(
  tags: Tag[],
  spotifyName: string,
  musicbrainzName: string | null,
): FacetedTags {
  const ownNames = new Set(
    [spotifyName, musicbrainzName]
      .filter((n): n is string => n !== null)
      .map((n) => n.trim().toLowerCase()),
  );

  const genres: Record<string, number> = {};
  const origins: Record<string, number> = {};
  const eras: Record<string, number> = {};

  for (const tag of tags) {
    const normalised = normaliseGenre(tag.name);

    // Compared case-insensitively (both sides lower-cased) rather than as an
    // exact string match: Last.fm and Spotify don't agree on capitalisation
    // for the same artist, and matching only the exact case pasted by a
    // human editor would silently let an own-name tag with different casing
    // survive into the output.
    if (ownNames.has(tag.name.trim().toLowerCase())) continue;

    const facet = facetOf(normalised);
    if (facet === null) continue;

    const bucket = facet === 'genre' ? genres : facet === 'origin' ? origins : eras;
    bucket[normalised] = (bucket[normalised] ?? 0) + tag.count;
  }

  return { genres, origins, eras };
}
