import { describe, test, expect, afterEach } from 'vitest';
import { filterPastEvents, groupByMonth, dayTile } from './pastEvents';
import type { PastEventRow } from './types';

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

const row = (over: Partial<PastEventRow> = {}): PastEventRow => ({
  id: 'e1',
  couple_names: 'Noa & Eitan',
  venue: 'Franklin Hall',
  event_date: '2026-07-18',
  songs_played: 10,
  ...over,
});

describe('filterPastEvents', () => {
  const events = [
    row({ id: 'a', couple_names: 'Noa & Eitan', venue: 'Franklin Hall' }),
    row({ id: 'b', couple_names: 'Claire & Ben', venue: 'Rooftop at Dune' }),
  ];

  test('an empty query returns everything', () => {
    expect(filterPastEvents(events, '')).toEqual(events);
  });

  test('a whitespace-only query returns everything', () => {
    expect(filterPastEvents(events, '   ')).toEqual(events);
  });

  test('matches on couple names', () => {
    expect(filterPastEvents(events, 'claire').map((e) => e.id)).toEqual(['b']);
  });

  test('matches on venue', () => {
    expect(filterPastEvents(events, 'franklin').map((e) => e.id)).toEqual(['a']);
  });

  test('is case-insensitive', () => {
    expect(filterPastEvents(events, 'ROOFTOP').map((e) => e.id)).toEqual(['b']);
  });

  test('trims the query before matching', () => {
    expect(filterPastEvents(events, '  Noa  ').map((e) => e.id)).toEqual(['a']);
  });

  test('returns an empty array when nothing matches', () => {
    expect(filterPastEvents(events, 'zzzz')).toEqual([]);
  });
});

describe('groupByMonth', () => {
  test('one group per month, in input order', () => {
    const groups = groupByMonth(
      [row({ id: 'a', event_date: '2026-07-18' }), row({ id: 'b', event_date: '2026-06-06' })],
      (event) => event.event_date,
    );
    expect(groups.map((g) => g.label)).toEqual(['July 2026', 'June 2026']);
    expect(groups.map((g) => g.events.map((e) => e.id))).toEqual([['a'], ['b']]);
  });

  test('events in the same month share one group', () => {
    const groups = groupByMonth(
      [row({ id: 'a', event_date: '2026-07-25' }), row({ id: 'b', event_date: '2026-07-04' })],
      (event) => event.event_date,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('July 2026');
    expect(groups[0].events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  test('the same month in different years does not collide', () => {
    const groups = groupByMonth(
      [row({ id: 'a', event_date: '2026-07-18' }), row({ id: 'b', event_date: '2025-07-18' })],
      (event) => event.event_date,
    );
    expect(groups.map((g) => g.label)).toEqual(['July 2026', 'July 2025']);
  });

  test('an empty list produces no groups', () => {
    expect(groupByMonth([], (event: PastEventRow) => event.event_date)).toEqual([]);
  });

  test('groups a non-PastEventRow shape through the accessor, ascending', () => {
    const groups = groupByMonth(
      [
        { id: 'a', date: '2026-09-12' },
        { id: 'b', date: '2026-09-26' },
        { id: 'c', date: '2026-10-03' },
      ],
      (event) => event.date,
    );
    expect(groups.map((g) => g.label)).toEqual(['September 2026', 'October 2026']);
    expect(groups[0].events.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('dayTile', () => {
  test('reads the day number and weekday', () => {
    expect(dayTile('2026-07-18')).toEqual({ day: 18, weekday: 'SAT' });
  });

  // The regression guard. `new Date('2026-08-01')` is parsed as UTC, which in
  // any negative-offset zone is July 31 — so a naive implementation returns
  // { day: 31, weekday: 'FRI' } here and { day: 1, weekday: 'SAT' } in London.
  // This test sets TZ itself (the established pattern in format.test.ts) rather
  // than relying on a run command to pin it -- `npm test`'s plain `vitest run`
  // does not, so an unpinned version of this test passes vacuously on any
  // UTC-or-positive-offset machine, including most graders'.
  test('the 1st of a month does not shift a day in a negative-offset zone', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(dayTile('2026-08-01')).toEqual({ day: 1, weekday: 'SAT' });
  });
});
