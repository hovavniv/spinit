import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUser() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));

import { getEventRecap } from './dal';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';
const DJ_ID = 'dj-1';
const PARTNER_USER_ID = 'partner-user-1';
const STRANGER_ID = 'stranger-1';

/**
 * The mocked query stands in for RLS's own decision: this test does not
 * exercise real Postgres RLS (that is Task 22's job, against the live
 * project as an actual partner -- attested, not verified, here). What THIS
 * test proves is that `getEventRecap`'s own code carries no additional
 * `.eq('dj_id', ...)` predicate that would refuse a row RLS already
 * admitted -- i.e. that the participant-check move actually removed the
 * ownership filter, not just the comment describing it.
 */
function eventsChain(eqCalls: [string, unknown][], result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return { eq, maybeSingle };
  });
  const select = vi.fn(() => ({ eq }));
  return { select };
}

function songsChain(result: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  return { select };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEventRecap', () => {
  it('returns null for a non-uuid id before any query', async () => {
    const result = await getEventRecap('banana');

    expect(result).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('the DJ gets the recap', async () => {
    requireUser.mockResolvedValue({ id: DJ_ID });
    const eventEqCalls: [string, unknown][] = [];
    from.mockImplementation((table: string) => {
      if (table === 'past_events_with_counts') {
        return eventsChain(eventEqCalls, {
          data: { id: EVENT_ID, couple_names: 'A & B', venue: 'The Hall', event_date: '2026-01-01' },
          error: null,
        });
      }
      if (table === 'played_songs') {
        return songsChain({ data: [{ position: 1, title: 'Song', artist: 'Artist', suggested_by: null }], error: null });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getEventRecap(EVENT_ID);

    expect(result).toEqual({
      event: { id: EVENT_ID, couple_names: 'A & B', venue: 'The Hall', event_date: '2026-01-01' },
      songs: [{ position: 1, title: 'Song', artist: 'Artist', suggested_by: null }],
    });
    // No ownership predicate: only the id filter, never a dj_id one.
    expect(eventEqCalls).toEqual([['id', EVENT_ID]]);
  });

  // The whole point of this task's change: a partner reaches the recap AND
  // gets the songs, not an empty playlist.
  it('a partner gets the recap WITH the songs', async () => {
    requireUser.mockResolvedValue({ id: PARTNER_USER_ID });
    const eventEqCalls: [string, unknown][] = [];
    from.mockImplementation((table: string) => {
      if (table === 'past_events_with_counts') {
        // Stands in for RLS admitting a partner: the row comes back even
        // though PARTNER_USER_ID is not this event's dj_id.
        return eventsChain(eventEqCalls, {
          data: { id: EVENT_ID, couple_names: 'A & B', venue: 'The Hall', event_date: '2026-01-01' },
          error: null,
        });
      }
      if (table === 'played_songs') {
        // Stands in for the widened played_songs policy (§15.3) admitting
        // the same partner. If getEventRecap still filtered by dj_id
        // anywhere, this fixture would never be reached.
        return songsChain({
          data: [
            { position: 1, title: 'First Dance', artist: 'Artist A', suggested_by: 'Guest 1' },
            { position: 2, title: 'Second Song', artist: 'Artist B', suggested_by: null },
          ],
          error: null,
        });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getEventRecap(EVENT_ID);

    expect(result).not.toBeNull();
    expect(result?.songs).toHaveLength(2);
    expect(result?.songs[0]).toEqual({
      position: 1,
      title: 'First Dance',
      artist: 'Artist A',
      suggested_by: 'Guest 1',
    });
    expect(eventEqCalls).toEqual([['id', EVENT_ID]]);
  });

  it('a signed-in user who is neither the DJ nor a partner gets null', async () => {
    requireUser.mockResolvedValue({ id: STRANGER_ID });
    const eventEqCalls: [string, unknown][] = [];
    from.mockImplementation((table: string) => {
      if (table === 'past_events_with_counts') {
        // Stands in for RLS excluding a stranger entirely: no row.
        return eventsChain(eventEqCalls, { data: null, error: null });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getEventRecap(EVENT_ID);

    expect(result).toBeNull();
  });

  it('an event that has not ended collapses to null, same as any other non-participant case', async () => {
    requireUser.mockResolvedValue({ id: PARTNER_USER_ID });
    const eventEqCalls: [string, unknown][] = [];
    from.mockImplementation((table: string) => {
      if (table === 'past_events_with_counts') {
        // past_events_with_counts only lists ENDED events -- an unfinished
        // event simply isn't in it, indistinguishable at this layer from
        // "no such event" or "not a participant".
        return eventsChain(eventEqCalls, { data: null, error: null });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getEventRecap(EVENT_ID);

    expect(result).toBeNull();
  });

  it('throws rather than returning null on a database error', async () => {
    requireUser.mockResolvedValue({ id: DJ_ID });
    const eventEqCalls: [string, unknown][] = [];
    from.mockImplementation((table: string) => {
      if (table === 'past_events_with_counts') {
        return eventsChain(eventEqCalls, { data: null, error: { message: 'boom' } });
      }
      throw new Error(`unexpected table ${table}`);
    });

    await expect(getEventRecap(EVENT_ID)).rejects.toThrow();
  });
});
