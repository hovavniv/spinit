/* No `import 'server-only'`: TasteProfile and CombinedTaste are rendered by a
   Client Component, the same reason detailTypes.ts sits apart from detailDal. */

export type TimeRange = 'short_term' | 'medium_term' | 'long_term';

export interface ScoredArtist {
  id: string;
  name: string;
  artworkUrl: string | null;
  score: number;
  ranges: TimeRange[];
}

/** One partner's stored profile. `topArtists` is the camelCase read of the
 *  `top_artists` jsonb column -- the DAL maps it; nothing else should. */
export interface TasteProfile {
  partnerId: string;
  topArtists: ScoredArtist[];
  computedAt: string;
}

/** A genre with its 0-1 fraction weight in a combined or per-partner profile. */
export interface WeightedGenre {
  name: string;
  weight: number;
}

/** Derived at render time from two profiles. */
export interface CombinedTaste {
  matchPercent: number;
  /** True when either side has no artists. Distinguishes "0% match" from
   *  "nothing to compare" -- one is about the couple, the other about the data. */
  noData: boolean;
  sharedArtists: ScoredArtist[];
  partner1Loves: ScoredArtist[];
  partner2Loves: ScoredArtist[];
  /** Both partners' artists pooled together, weighted by genreWeights, sorted
   *  descending, capped at 10. */
  topGenres: WeightedGenre[];
  /** At most 4 genres with the largest asymmetry between the two partners'
   *  individual genreWeights -- see combineTaste in taste.ts for the exact
   *  qualifying condition and ranking. */
  avoidGenres: string[];
}
