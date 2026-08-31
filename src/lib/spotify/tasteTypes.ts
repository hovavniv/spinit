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

/** Derived at render time from two profiles. C1 carries NO genre fields:
 *  design §6.1 lists topGenres and avoidGenres, and this slice deliberately
 *  omits them because genres do not exist until C2. Stated so the omission
 *  reads as a decision rather than a gap. */
export interface CombinedTaste {
  matchPercent: number;
  /** True when either side has no artists. Distinguishes "0% match" from
   *  "nothing to compare" -- one is about the couple, the other about the data. */
  noData: boolean;
  sharedArtists: ScoredArtist[];
  partner1Loves: ScoredArtist[];
  partner2Loves: ScoredArtist[];
}
