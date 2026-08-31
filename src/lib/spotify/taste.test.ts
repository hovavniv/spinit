import { describe, expect, it } from 'vitest';
import { mergeRanges, combineTaste } from './taste';

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
});
