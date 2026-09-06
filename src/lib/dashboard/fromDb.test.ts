import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  toLiveEvent,
  toUpcomingEvents,
  toPastEvents,
  toDashboardData,
  type DashboardEventRow,
  type PastEventCountRow,
} from './fromDb';
import type { CoupleStatus } from './types';

function row(overrides: Partial<DashboardEventRow> = {}): DashboardEventRow {
  return {
    id: 'maya-tomer',
    couple_names: 'Maya & Tomer',
    venue: 'The Wilshire Ebell',
    event_date: '2026-08-27',
    status: 'upcoming',
    phase: 'dinner',
    start_time: null,
    event_partners: [],
    ...overrides,
  };
}

/**
 * Builds the `event_partners` embed for a row: one entry per argument, each
 * either a connection status string or `null` for "no connection row yet".
 * `spotify_connections` embeds to-one (object or null), never an array —
 * see the comment on `EventPartnerRow` in fromDb.ts.
 */
function partners(...statuses: (string | null)[]): Partial<DashboardEventRow> {
  return {
    event_partners: statuses.map((s) => ({
      spotify_connections: s === null ? null : { status: s as 'invited' | 'connected' | 'failed' },
    })),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toLiveEvent', () => {
  it('returns the live row, composing startedAt from the date and time', () => {
    const live = row({ status: 'live', start_time: '20:00:00', phase: 'open-floor' });
    expect(toLiveEvent([row(), live])).toEqual({
      id: 'maya-tomer',
      coupleNames: 'Maya & Tomer',
      venue: 'The Wilshire Ebell',
      phase: 'open-floor',
      startedAt: '2026-08-27T20:00',
    });
  });

  it('returns null when no row is live', () => {
    expect(toLiveEvent([row(), row({ status: 'completed' })])).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(toLiveEvent([])).toBeNull();
  });

  it('treats a live row with no start_time as not live, and logs', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toLiveEvent([row({ status: 'live', start_time: null })])).toBeNull();
    expect(error).toHaveBeenCalledOnce();
  });

  it('drops the seconds from start_time', () => {
    const live = row({ status: 'live', start_time: '09:05:37' });
    expect(toLiveEvent([live])!.startedAt).toBe('2026-08-27T09:05');
  });

  it('finds the genuinely live row even when an earlier live row is broken', () => {
    // Nothing in the schema forbids two `live` rows — no partial unique index,
    // no check constraint. `rows.find(r => r.status === 'live')` alone would
    // return the earlier, broken one and the genuinely live event would never
    // show a banner. Design §6's rule is "status === 'live' AND a non-null
    // start_time", so both conditions must be honoured together.
    const broken = row({ id: 'broken', status: 'live', start_time: null });
    const genuine = row({ id: 'genuine', status: 'live', start_time: '21:00:00' });
    expect(toLiveEvent([broken, genuine])).toEqual(
      expect.objectContaining({ id: 'genuine', startedAt: '2026-08-27T21:00' }),
    );
  });
});

describe('toUpcomingEvents', () => {
  it('keeps only upcoming rows, mapped to the card props', () => {
    const rows = [
      row({ id: 'live-one', status: 'live', start_time: '20:00:00' }),
      row({
        id: 'priya-alex',
        couple_names: 'Priya & Alex',
        venue: 'Brookline Barn',
        event_date: '2026-09-12',
        status: 'upcoming',
        ...partners('connected', 'connected'),
      }),
      row({ id: 'done', status: 'completed' }),
      row({ id: 'sketch', status: 'draft' }),
    ];
    expect(toUpcomingEvents(rows)).toEqual([
      {
        id: 'priya-alex',
        coupleNames: 'Priya & Alex',
        venue: 'Brookline Barn',
        date: '2026-09-12',
        status: 'streaming-connected',
      },
    ]);
  });

  it('preserves the order the query returned', () => {
    const rows = [
      row({ id: 'b', event_date: '2026-09-12' }),
      row({ id: 'a', event_date: '2026-10-03' }),
    ];
    expect(toUpcomingEvents(rows).map((event) => event.id)).toEqual(['b', 'a']);
  });

  it('derives couple_status independently per row within one batch', () => {
    const rows = [
      row({ id: 'one', ...partners('connected', 'connected') }),
      row({ id: 'two', ...partners('connected', null) }),
    ];
    expect(toUpcomingEvents(rows).map((event) => event.status)).toEqual([
      'streaming-connected',
      'partly-connected',
    ]);
  });

  it('returns an empty array for a DJ with no events', () => {
    expect(toUpcomingEvents([])).toEqual([]);
  });

  describe('couple_status derivation', () => {
    it.each<[string, (string | null)[], CoupleStatus]>([
      [
        'is streaming-connected only when BOTH partners are connected',
        ['connected', 'connected'],
        'streaming-connected',
      ],
      [
        'is partly-connected when only one partner is connected',
        ['connected', null],
        'partly-connected',
      ],
      [
        // 'failed' and 'invited' are both rows -- presence is not connectedness.
        "is partly-connected when a partner's connection exists but FAILED",
        ['connected', 'failed'],
        'partly-connected',
      ],
      [
        // A half-set-up event must not read as connected just because its
        // single slot is. Count connected partners, never "no partner is
        // unconnected" (every() over a 1-element array is vacuously true).
        'is partly-connected when the event has only ONE partner slot',
        ['connected'],
        'partly-connected',
      ],
      [
        'is awaiting-couple when the event has no partner slots at all',
        [],
        'awaiting-couple',
      ],
      [
        'ignores a third partner row rather than throwing',
        ['connected', 'connected', 'invited'],
        'streaming-connected',
      ],
      [
        'is streaming-connected with 2 of 3 partner rows connected',
        ['connected', 'connected', null],
        'streaming-connected',
      ],
      [
        'counts an INVITED connection as not connected',
        ['connected', 'invited'],
        'partly-connected',
      ],
    ])('%s', (_description, statuses, expected) => {
      const [event] = toUpcomingEvents([row(partners(...statuses))]);
      expect(event.status).toBe(expected);
    });
  });
});

describe('toPastEvents', () => {
  it('maps view rows to the past-event row props', () => {
    const rows: PastEventCountRow[] = [
      {
        id: 'noa-eitan',
        couple_names: 'Noa & Eitan',
        venue: 'Franklin Hall',
        event_date: '2026-07-18',
        songs_played: 10,
      },
    ];
    expect(toPastEvents(rows)).toEqual([
      {
        id: 'noa-eitan',
        coupleNames: 'Noa & Eitan',
        venue: 'Franklin Hall',
        date: '2026-07-18',
        songsPlayed: 10,
      },
    ]);
  });

  it('carries a genuine zero count through, rather than treating it as absent', () => {
    const rows: PastEventCountRow[] = [
      {
        id: 'silent',
        couple_names: 'Dana & Ori',
        venue: 'The Foundry',
        event_date: '2026-05-01',
        songs_played: 0,
      },
    ];
    expect(toPastEvents(rows)[0].songsPlayed).toBe(0);
  });
});

describe('toDashboardData', () => {
  const profile = {
    id: 'dj-1',
    full_name: 'Jordan Ellis',
    business_name: 'Ellis Sound Co.',
    phone: '+972 50 000 0000',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('assembles every field the screen reads', () => {
    const data = toDashboardData({
      profile,
      activeRows: [row({ status: 'live', start_time: '20:00:00' })],
      pastRows: [],
      now: '2026-08-27T20:00',
    });
    expect(data.dj).toEqual({ name: 'Jordan Ellis', company: 'Ellis Sound Co.' });
    expect(data.now).toBe('2026-08-27T20:00');
    expect(data.liveEvent).not.toBeNull();
    expect(data.upcoming).toEqual([]);
    expect(data.past).toEqual([]);
  });

  it('renders a null business_name as an empty string, never "null"', () => {
    const data = toDashboardData({
      profile: { ...profile, business_name: null },
      activeRows: [],
      pastRows: [],
      now: '2026-08-27T20:00',
    });
    expect(data.dj.company).toBe('');
  });

  it('falls back to an empty name when the profile could not be read', () => {
    const data = toDashboardData({
      profile: null,
      activeRows: [],
      pastRows: [],
      now: '2026-08-27T20:00',
    });
    expect(data.dj).toEqual({ name: '', company: '' });
  });
});
