import { describe, expect, test } from 'vitest';
import { filterUpcomingEvents, STATUS_FILTERS, BADGE_LABELS } from './upcomingEvents';
import type { UpcomingEvent } from '@/lib/dashboard/types';
import { toUpcomingEvents, type DashboardEventRow } from '@/lib/dashboard/fromDb';
import { todayInAppTimezone } from '@/lib/dashboard/now';

function event(overrides: Partial<UpcomingEvent> = {}): UpcomingEvent {
  return {
    id: 'a',
    coupleNames: 'Maya & Chris',
    venue: 'Cedar Hall',
    date: '2026-09-06',
    status: 'awaiting-couple',
    ...overrides,
  };
}

const events: UpcomingEvent[] = [
  event({ id: 'a', coupleNames: 'Maya & Chris', venue: 'Cedar Hall', status: 'awaiting-couple' }),
  event({ id: 'b', coupleNames: 'Priya & Alex', venue: 'Brookline Barn', status: 'streaming-connected' }),
  event({ id: 'c', coupleNames: 'Sam & Jordan', venue: 'The Foundry', status: 'partly-connected' }),
];

describe('filterUpcomingEvents', () => {
  test('an empty query and the all filter return the input unchanged', () => {
    expect(filterUpcomingEvents(events, '', 'all')).toEqual(events);
  });

  test('a whitespace-only query matches everything', () => {
    expect(filterUpcomingEvents(events, '   ', 'all')).toEqual(events);
  });

  test('matches couple names case-insensitively', () => {
    expect(filterUpcomingEvents(events, 'priya', 'all').map((e) => e.id)).toEqual(['b']);
  });

  test('matches the venue', () => {
    expect(filterUpcomingEvents(events, 'foundry', 'all').map((e) => e.id)).toEqual(['c']);
  });

  test('trims the query before matching', () => {
    expect(filterUpcomingEvents(events, '  Cedar  ', 'all').map((e) => e.id)).toEqual(['a']);
  });

  test('returns an empty array when nothing matches', () => {
    expect(filterUpcomingEvents(events, 'zzzz', 'all')).toEqual([]);
  });

  test('each status filter admits only its own rows', () => {
    expect(filterUpcomingEvents(events, '', 'streaming-connected').map((e) => e.id)).toEqual(['b']);
    expect(filterUpcomingEvents(events, '', 'partly-connected').map((e) => e.id)).toEqual(['c']);
    expect(filterUpcomingEvents(events, '', 'awaiting-couple').map((e) => e.id)).toEqual(['a']);
  });

  test('query and filter compose: a row must satisfy both', () => {
    // 'Sam' matches only c, whose status is partly-connected.
    expect(filterUpcomingEvents(events, 'Sam', 'partly-connected').map((e) => e.id)).toEqual(['c']);
    expect(filterUpcomingEvents(events, 'Sam', 'streaming-connected')).toEqual([]);
  });
});

describe('the label maps', () => {
  test('STATUS_FILTERS is All plus one pill per CoupleStatus', () => {
    expect(STATUS_FILTERS.map((f) => f.key)).toEqual([
      'all',
      'streaming-connected',
      'partly-connected',
      'awaiting-couple',
    ]);
  });

  test('BADGE_LABELS reads the way the artboard draws it', () => {
    expect(BADGE_LABELS).toEqual({
      'streaming-connected': 'Streaming connected',
      'partly-connected': '1 of 2 connected',
      'awaiting-couple': 'No profiles connected',
    });
  });
});

/**
 * The status axis of the upcoming/ended complement: over the three statuses a
 * DJ is shown, the two screens partition the events. draft and cancelled are
 * on NEITHER, deliberately.
 *
 * The DATE axis is not tested here and cannot be — see this task's preamble.
 */
describe('the upcoming/ended boundary', () => {
  const CLOCK = new Date('2026-09-04T09:00:00Z'); // 12:00 in Jerusalem
  const TODAY = '2026-09-04';

  function eventRow(over: Partial<DashboardEventRow>): DashboardEventRow {
    return {
      id: 'e',
      couple_names: 'A & B',
      venue: 'V',
      event_date: TODAY,
      status: 'upcoming',
      phase: null,
      start_time: null,
      event_partners: [],
      ...over,
    };
  }

  test('todayInAppTimezone anchors the boundary', () => {
    expect(todayInAppTimezone(CLOCK)).toBe(TODAY);
  });

  test('toUpcomingEvents admits only upcoming rows, whatever their date', () => {
    const rows = [
      eventRow({ id: 'up', status: 'upcoming' }),
      eventRow({ id: 'live', status: 'live' }),
      eventRow({ id: 'draft', status: 'draft' }),
      eventRow({ id: 'cancelled', status: 'cancelled' }),
      eventRow({ id: 'done', status: 'completed' }),
    ];
    expect(toUpcomingEvents(rows).map((e) => e.id)).toEqual(['up']);
  });
});
