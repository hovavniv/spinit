import { describe, expect, it } from 'vitest';
import { mergeRanges, combineTaste, genreWeights } from './taste';
import type { ScoredArtist } from './tasteTypes';

const a = (id: string, name: string) => ({ id, name, artworkUrl: null });

describe('mergeRanges — design §2.12', () => {
  it('scores by rangeWeight * (1 - rank/len), taking the best across ranges', () => {
    const merged = mergeRanges({
      short_term: [a('1', 'One'), a('2', 'Two')],
      medium_term: [],
      long_term: [a('2', 'Two')],
    });
    // '1': 1.0 * (1 - 0/2) = 1.0 ; '2': max(1.0*(1-1/2), 0.6*(1-0/1)) = 0.6
    expect(merged.map((m) => m.id)).toEqual(['1', '2']);
    expect(merged[0].score).toBeCloseTo(1.0);
    expect(merged[1].score).toBeCloseTo(0.6);
  });

  it('records which ranges an artist appeared in', () => {
    const [first] = mergeRanges({
      short_term: [a('1', 'One')], medium_term: [a('1', 'One')], long_term: [],
    });
    expect(first.ranges).toEqual(['short_term', 'medium_term']);
  });

  it('breaks a GENUINE tie by spotify id, ascending', () => {
    // A genuine, exact tie -- checked with `node -e`, `===` true:
    //   medium_term rank 3 of 4 : 0.8 * (1 - 3/4) = 0.20000000000000001110
    //   long_term   rank 2 of 3 : 0.6 * (1 - 2/3) = 0.20000000000000001110
    const merged = mergeRanges({
      short_term: [],
      medium_term: [a('m1', 'M'), a('m2', 'M'), a('m3', 'M'), a('bbb', 'B')],
      long_term: [a('y1', 'Y'), a('y2', 'Y'), a('aaa', 'A')],
    });
    const tiedScore = 0.8 * (1 - 3 / 4);
    const tied = merged.filter((m) => m.score === tiedScore).map((m) => m.id);
    expect(tied).toEqual(['aaa', 'bbb']);   // ascending by id, not insertion order
  });

  it('returns [] when every range is empty — the insufficient-history case', () => {
    expect(mergeRanges({ short_term: [], medium_term: [], long_term: [] })).toEqual([]);
  });

  it('does not divide by zero on an empty range', () => {
    expect(() => mergeRanges({
      short_term: [], medium_term: [a('1', 'One')], long_term: [],
    })).not.toThrow();
  });

  it('keeps the best score across ranges even when the LATER-processed range is lower', () => {
    // RANGE_ORDER processes short_term before long_term. Artist '1' gets a
    // HIGH contribution from the earlier-processed range and a LOWER
    // contribution from the later-processed range -- the opposite ordering
    // from the "scores by rangeWeight" test above (where the later range
    // happened to also be the higher one, so `if (true)` would coincidentally
    // pass it too). This is the only shape that can distinguish the correct
    // `if (contribution > existing.score)` from a broken `if (true)`.
    //   short_term rank 0 of 1: 1.0 * (1 - 0/1) = 1.0  (processed first)
    //   long_term  rank 0 of 1: 0.6 * (1 - 0/1) = 0.6  (processed later, lower)
    // Correct: keep 1.0 (0.6 is not > 1.0). Broken `if (true)`: overwritten to 0.6.
    const [merged] = mergeRanges({
      short_term: [a('1', 'One')],
      medium_term: [],
      long_term: [a('1', 'One')],
    });
    expect(merged.score).toBeCloseTo(1.0);
  });
});

describe('combineTaste — artist-derived, per design §6.1', () => {
  const p = (ids: string[]) => ({
    topArtists: ids.map((id, i) => ({ id, name: id, score: 1 - i * 0.1, ranges: [] })),
  });

  it('gives 100% for identical sets', () => {
    expect(combineTaste(p(['1', '2']), p(['1', '2'])).matchPercent).toBe(100);
  });

  it('gives 0% for disjoint sets', () => {
    expect(combineTaste(p(['1']), p(['2'])).matchPercent).toBe(0);
  });

  it('returns 0 WITH a noData flag for two empty sets, never NaN', () => {
    const r = combineTaste(p([]), p([]));
    expect(r.matchPercent).toBe(0);
    expect(r.noData).toBe(true);
    expect(Number.isNaN(r.matchPercent)).toBe(false);
  });

  it('sets noData when only ONE side is empty', () => {
    expect(combineTaste(p(['1']), p([])).noData).toBe(true);
  });

  it('shared artists are the intersection, ordered by combined score', () => {
    expect(combineTaste(p(['1', '2']), p(['2', '3'])).sharedArtists.map((s) => s.id))
      .toEqual(['2']);
  });

  it("each partner's exclusives exclude the shared ones", () => {
    const r = combineTaste(p(['1', '2']), p(['2', '3']));
    expect(r.partner1Loves.map((x) => x.id)).toEqual(['1']);
    expect(r.partner2Loves.map((x) => x.id)).toEqual(['3']);
  });

  it('is symmetric in matchPercent', () => {
    const x = p(['1', '2', '3']); const y = p(['2', '3', '4']);
    expect(combineTaste(x, y).matchPercent).toBe(combineTaste(y, x).matchPercent);
  });

  it('computes a partial overlap correctly, not just 0% and 100%', () => {
    // p1: {1:1.0, 2:0.9}   p2: {2:1.0, 3:0.9}
    // intersection = min(1.0,0) + min(0.9,1.0) + min(0,0.9) = 0 + 0.9 + 0 = 0.9
    // union        = max(1.0,0) + max(0.9,1.0) + max(0,0.9) = 1.0 + 1.0 + 0.9 = 2.9
    // matchPercent = round(100 * 0.9 / 2.9) = round(31.03...) = 31
    expect(combineTaste(p(['1', '2']), p(['2', '3'])).matchPercent).toBe(31);
  });

  it('sorts sharedArtists by the SUM of both sides scores, not just one side', () => {
    // Two shared artists with deliberately opposite per-side magnitudes, so
    // that "sum of both sides" and "partner1's side alone" disagree on order:
    //   x: partner1=0.5, partner2=0.9 -> combined 1.4
    //   y: partner1=0.9, partner2=0.1 -> combined 1.0
    // Correct (sum): x (1.4) before y (1.0).
    // Broken (a1.score alone, dropping partner2's contribution): x's key
    // becomes 0.5 and y's becomes 0.9, so the sort flips to y before x.
    const partner1 = { topArtists: [
      { id: 'x', name: 'X', score: 0.5, ranges: [] },
      { id: 'y', name: 'Y', score: 0.9, ranges: [] },
    ] };
    const partner2 = { topArtists: [
      { id: 'x', name: 'X', score: 0.9, ranges: [] },
      { id: 'y', name: 'Y', score: 0.1, ranges: [] },
    ] };
    expect(combineTaste(partner1, partner2).sharedArtists.map((s) => s.id)).toEqual(['x', 'y']);
  });
});

const sa = (id: string, score: number): ScoredArtist =>
  ({ id, name: id, artworkUrl: null, score, ranges: ['medium_term'] });

describe('genreWeights — design §6.1', () => {
  it("scales each artist's tags by that artist's score", () => {
    const out = genreWeights([sa('x', 3), sa('y', 1)], {
      x: { pop: 100 },
      y: { rock: 100 },
    });
    // x contributes 3x what y does, so pop is 0.75 and rock 0.25
    expect(out.pop).toBeCloseTo(0.75, 6);
    expect(out.rock).toBeCloseTo(0.25, 6);
  });

  it('normalises to fractions summing to 1', () => {
    const out = genreWeights([sa('x', 2), sa('y', 5)], {
      x: { pop: 60, disco: 40 },
      y: { rock: 90 },
    });
    const sum = Object.values(out).reduce((t, v) => t + v, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('contributes nothing for an artist with no resolved row', () => {
    const out = genreWeights([sa('x', 3), sa('missing', 99)], { x: { pop: 100 } });
    expect(out).toEqual({ pop: 1 });
  });

  it('returns {} for no resolved artists, without dividing by zero', () => {
    expect(genreWeights([sa('x', 3)], {})).toEqual({});
    expect(genreWeights([], {})).toEqual({});
  });

  it('an artist with a resolved but EMPTY genre map contributes nothing, not NaN', () => {
    const out = genreWeights([sa('x', 3), sa('y', 1)], { x: {}, y: { rock: 100 } });
    expect(out).toEqual({ rock: 1 });
    expect(Object.values(out).every(Number.isFinite)).toBe(true);
  });
});

describe('combineTaste — genre fields, per design §6.1 / plan task 8', () => {
  it('topGenres surfaces what both partners share', () => {
    const combined = combineTaste(
      { topArtists: [sa('x', 3)] },
      { topArtists: [sa('y', 3)] },
      { x: { pop: 100 }, y: { pop: 100 } },
    );
    expect(combined.topGenres.map((g) => g.name)).toContain('pop');
  });

  it('avoidGenres names the asymmetric genres, never one they share', () => {
    const combined = combineTaste(
      { topArtists: [sa('x', 3)] },
      { topArtists: [sa('y', 3)] },
      { x: { pop: 100, metal: 100 }, y: { pop: 100 } },
    );
    expect(combined.avoidGenres).toContain('metal');   // x loves it, y has none
    expect(combined.avoidGenres).not.toContain('pop'); // both love it
  });

  it('caps avoidGenres at four', () => {
    const combined = combineTaste(
      { topArtists: [sa('x', 3)] },
      { topArtists: [sa('y', 3)] },
      // six genres x loves and y has none of, plus one they share
      { x: { pop: 100, metal: 90, jazz: 80, techno: 70, punk: 60, ska: 50, opera: 40 },
        y: { pop: 100 } },
    );
    expect(combined.avoidGenres).toHaveLength(4);
    expect(combined.avoidGenres).not.toContain('pop');
  });

  it('is empty when both partners like exactly the same things', () => {
    const combined = combineTaste(
      { topArtists: [sa('x', 3)] }, { topArtists: [sa('y', 3)] },
      { x: { pop: 100 }, y: { pop: 100 } },
    );
    expect(combined.avoidGenres).toEqual([]);
  });
});
