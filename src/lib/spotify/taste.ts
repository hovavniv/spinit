// No `import 'server-only'` -- matches tasteTypes.ts: rendered client-side.

import type { CombinedTaste, ScoredArtist, TimeRange } from './tasteTypes';

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

interface PartialProfile {
  topArtists: CombineArtistInput[];
}

function toScoredArtist(a: CombineArtistInput): ScoredArtist {
  return { ...a, artworkUrl: a.artworkUrl ?? null };
}

/**
 * Combines two partners' merged top-artist lists into a shared-taste report.
 * `matchPercent` uses a weighted Jaccard overlap (intersection over union,
 * by min/max of each side's score for shared artists) so the result is
 * symmetric in its two arguments. Shared-artist combined score is the sum
 * of both sides' individual scores for that artist -- not spec'd exactly,
 * chosen only to produce a sane descending order.
 */
export function combineTaste(partner1: PartialProfile, partner2: PartialProfile): CombinedTaste {
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

  return {
    matchPercent,
    noData,
    sharedArtists,
    partner1Loves,
    partner2Loves,
  };
}
