/** Shared shapes for the genre-enrichment slice, so lastfm.ts, filter.ts,
 *  musicbrainz.ts (etc) don't each declare their own copy of the same tag. */

export interface Tag {
  name: string;
  count: number;
}

export interface FacetedTags {
  genres: Record<string, number>;
  origins: Record<string, number>;
  eras: Record<string, number>;
}
