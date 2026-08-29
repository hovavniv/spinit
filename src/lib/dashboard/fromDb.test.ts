import { describe, expect, it, vi, afterEach } from 'vitest';
import { toLiveEvent, type DashboardEventRow } from './fromDb';

function row(overrides: Partial<DashboardEventRow> = {}): DashboardEventRow {
  return {
    id: 'maya-tomer',
    couple_names: 'Maya & Tomer',
    venue: 'The Wilshire Ebell',
    event_date: '2026-08-27',
    status: 'upcoming',
    phase: 'cocktails',
    start_time: null,
    couple_status: 'awaiting-couple',
    ...overrides,
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
