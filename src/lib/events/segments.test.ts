import { describe, test, expect } from 'vitest';

import { splitBySegment } from './segments';
import type { MustPlayRow } from './detailTypes';

function row(id: string, segment: MustPlayRow['segment']): MustPlayRow {
  return {
    id,
    segment,
    title: `title ${id}`,
    artist: null,
    moment: null,
    created_at: '2026-08-30T10:00:00Z',
  };
}

describe('splitBySegment', () => {
  test('files each row under its own segment', () => {
    const result = splitBySegment([row('a', 'ceremony'), row('b', 'reception'), row('c', 'party')]);

    expect(result.ceremony.map((r) => r.id)).toEqual(['a']);
    expect(result.reception.map((r) => r.id)).toEqual(['b']);
    expect(result.party.map((r) => r.id)).toEqual(['c']);
  });

  test('returns three empty arrays for no rows, never undefined', () => {
    const result = splitBySegment([]);

    expect(result.ceremony).toEqual([]);
    expect(result.reception).toEqual([]);
    expect(result.party).toEqual([]);
  });

  test('preserves the order rows arrive in', () => {
    // The query orders at PostgREST (detailDal), so this function must not
    // reorder -- a sort here would silently take over an ordering decision
    // that belongs to the query.
    const result = splitBySegment([row('b', 'party'), row('a', 'party')]);

    expect(result.party.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
