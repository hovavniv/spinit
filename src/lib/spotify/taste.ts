// No `import 'server-only'` -- matches tasteTypes.ts: rendered client-side.

import type { CombinedTaste, ScoredArtist, TimeRange, WeightedGenre } from './tasteTypes';

const RANGE_WEIGHT: Record<TimeRange, number> = {
  short_term: 1.0,
  medium_term: 0.8,
  long_term: 0.6,
};

const RANGE_ORDER: TimeRange[] = ['short_term', 'medium_term', 'long_term'];

interface RawArtist {
  id: string;
  name: string;
  artworkUrl: string | null;
}

export interface ByRange {
  short_term: RawArtist[];
  medium_term: RawArtist[];
  long_term: RawArtist[];
}

/**
 * Merges an artist's per-range rankings into a single ScoredArtist list,
 * per design §2.12. An artist's score is the MAX contribution across the
 * ranges it appears in (not summed), where a single range's contribution
 * for an artist at 0-indexed rank `r` of `len` is
 * `rangeWeight * (1 - r / len)`. Sorted descending by score; exact ties
 * break by ascending spotify id.
 */
export function mergeRanges(byRange: ByRange): ScoredArtist[] {
  const byId = new Map<string, ScoredArtist>();

  for (const range of RANGE_ORDER) {
    const artists = byRange[range];
    const len = artists.length;
    if (len === 0) continue; // avoid dividing by zero on an empty range

    const weight = RANGE_WEIGHT[range];
    artists.forEach((artist, rank) => {
      const contribution = weight * (1 - rank / len);
      const existing = byId.get(artist.id);
      if (!existing) {
        byId.set(artist.id, {
          id: artist.id,
          name: artist.name,
          artworkUrl: artist.artworkUrl,
          score: contribution,
          ranges: [range],
        });
        return;
      }

      existing.ranges.push(range);
      if (contribution > existing.score) {
        existing.score = contribution;
      }
    });
  }

  return Array.from(byId.values()).sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

// `artworkUrl` is optional here (and normalized to `null` on output) because
// callers such as taste.test.ts build fixture artists without it -- only id,
// name, score, and ranges matter to the combining logic itself.
interface CombineArtistInput {
  id: string;
  name: string;
  score: number;
  ranges: TimeRange[];
  artworkUrl?: string | null;
}

export interface PartialProfile {
  topArtists: CombineArtistInput[];
}

function toScoredArtist(a: CombineArtistInput): ScoredArtist {
  return { ...a, artworkUrl: a.artworkUrl ?? null };
}

/**
 * Weights genres across a list of artists by each artist's own score, per
 * design §6.1. Genres arrive as a SECOND argument keyed by artist id (they
 * live in `artist_genres`, keyed per event, not on the artist itself) --
 * an artist with no row in `genresByArtistId` contributes nothing, not an
 * error. Each artist's full genre-count map is treated as a single unit
 * scaled by that artist's score (contribution to a genre =
 * `artist.score * count`, summed per genre across all artists), and the
 * WHOLE resulting record is normalized at the end so it sums to 1 --
 * NOT normalized per-artist first. Returns {} (never NaN) when the grand
 * total is 0, e.g. no artist has any resolved genre data.
 */
export function genreWeights(
  artists: ScoredArtist[],
  genresByArtistId: Record<string, Record<string, number>>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  let grandTotal = 0;

  for (const artist of artists) {
    const genres = genresByArtistId[artist.id];
    if (!genres) continue;

    for (const [genre, count] of Object.entries(genres)) {
      const contribution = artist.score * count;
      totals[genre] = (totals[genre] ?? 0) + contribution;
      grandTotal += contribution;
    }
  }

  if (grandTotal === 0) return {};

  const normalized: Record<string, number> = {};
  for (const [genre, total] of Object.entries(totals)) {
    normalized[genre] = total / grandTotal;
  }
  return normalized;
}

const TOP_GENRES_CAP = 10;
const AVOID_GENRES_CAP = 4;
const AVOID_GENRES_HIGH_THRESHOLD = 0.1;
const AVOID_GENRES_LOW_THRESHOLD = 0.02;

/**
 * The ≤4 genres with the largest asymmetry between the two partners' OWN
 * genreWeights (each computed from that partner's own topArtists, not the
 * pooled list) -- a genre qualifies only when one side's weight is >= 0.10
 * and the other's is < 0.02 (either direction), ranked by the gap size
 * descending. This is a product decision this task makes, not something
 * design revision 6 states outright: "genres neither partner listens to"
 * (the plan's original wording) is unbounded (69 entries against today's
 * vocabulary) and vacuous under every mutation, since a couple who share
 * one genre already exclude it from an "neither of us" list regardless of
 * what the rest of the array holds. "One partner loves it, the other never
 * plays it" is bounded, uses both profiles, and is the actual dance-floor
 * risk the panel exists to name.
 */
function avoidGenres(
  weights1: Record<string, number>,
  weights2: Record<string, number>,
): string[] {
  const allGenres = new Set([...Object.keys(weights1), ...Object.keys(weights2)]);
  const gaps: { genre: string; gap: number }[] = [];

  for (const genre of allGenres) {
    const w1 = weights1[genre] ?? 0;
    const w2 = weights2[genre] ?? 0;
    const asymmetric =
      (w1 >= AVOID_GENRES_HIGH_THRESHOLD && w2 < AVOID_GENRES_LOW_THRESHOLD) ||
      (w2 >= AVOID_GENRES_HIGH_THRESHOLD && w1 < AVOID_GENRES_LOW_THRESHOLD);
    if (!asymmetric) continue;
    gaps.push({ genre, gap: Math.abs(w1 - w2) });
  }

  return gaps
    .sort((x, y) => y.gap - x.gap)
    .slice(0, AVOID_GENRES_CAP)
    .map((g) => g.genre);
}

function topGenres(weights: Record<string, number>): WeightedGenre[] {
  return Object.entries(weights)
    .map(([name, weight]) => ({ name, weight }))
    .sort((x, y) => y.weight - x.weight)
    .slice(0, TOP_GENRES_CAP);
}

/**
 * Combines two partners' merged top-artist lists into a shared-taste report.
 * `matchPercent` uses a weighted Jaccard overlap (intersection over union,
 * by min/max of each side's score for shared artists) so the result is
 * symmetric in its two arguments. Shared-artist combined score is the sum
 * of both sides' individual scores for that artist -- not spec'd exactly,
 * chosen only to produce a sane descending order. `genresByArtistId`
 * defaults to `{}` so C1's 2-arg call sites keep compiling unchanged.
 */
export function combineTaste(
  partner1: PartialProfile,
  partner2: PartialProfile,
  genresByArtistId: Record<string, Record<string, number>> = {},
): CombinedTaste {
  const list1 = partner1.topArtists;
  const list2 = partner2.topArtists;

  const noData = list1.length === 0 || list2.length === 0;

  const map1 = new Map(list1.map((a) => [a.id, a]));
  const map2 = new Map(list2.map((a) => [a.id, a]));

  let intersectionWeight = 0;
  let unionWeight = 0;
  const allIds = new Set([...map1.keys(), ...map2.keys()]);
  for (const id of allIds) {
    const s1 = map1.get(id)?.score ?? 0;
    const s2 = map2.get(id)?.score ?? 0;
    intersectionWeight += Math.min(s1, s2);
    unionWeight += Math.max(s1, s2);
  }

  const matchPercent = unionWeight === 0 ? 0 : Math.round((intersectionWeight / unionWeight) * 100);

  const sharedIds = list1.filter((a) => map2.has(a.id)).map((a) => a.id);
  const sharedArtists = sharedIds
    .map((id) => {
      const a1 = map1.get(id)!;
      const a2 = map2.get(id)!;
      return { artist: a1, combinedScore: a1.score + a2.score };
    })
    .sort((x, y) => y.combinedScore - x.combinedScore)
    .map((x) => toScoredArtist(x.artist));

  const sharedIdSet = new Set(sharedIds);
  const partner1Loves = list1.filter((a) => !sharedIdSet.has(a.id)).map(toScoredArtist);
  const partner2Loves = list2.filter((a) => !sharedIdSet.has(a.id)).map(toScoredArtist);

  const scoredList1 = list1.map(toScoredArtist);
  const scoredList2 = list2.map(toScoredArtist);
  const weights1 = genreWeights(scoredList1, genresByArtistId);
  const weights2 = genreWeights(scoredList2, genresByArtistId);
  const pooledWeights = genreWeights([...scoredList1, ...scoredList2], genresByArtistId);

  return {
    matchPercent,
    noData,
    sharedArtists,
    partner1Loves,
    partner2Loves,
    topGenres: topGenres(pooledWeights),
    avoidGenres: avoidGenres(weights1, weights2),
  };
}
