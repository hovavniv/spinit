import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const requireUser = vi.fn();
const revalidatePath = vi.fn();
const from = vi.fn();
const rpc = vi.fn();

vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUser() }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from, rpc: (...args: [string, unknown]) => rpc(...args) }),
}));

import { startEvent, setPhase, playSuggestion, playPick, skipSuggestion } from './liveActions';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

/**
 * Captures the exact payload passed to `.update()` and every `.eq()` filter
 * key/value, so a test can assert the whole shape of the write rather than
 * just its outcome.
 */
function tableDouble(result: { data: unknown[] | null; error: { code?: string; message: string } | null }) {
  const calls: { update?: Record<string, unknown>; eq: [string, unknown][] } = { eq: [] };
  const eq = vi.fn((key: string, value: unknown) => {
    calls.eq.push([key, value]);
    return builder;
  });
  const builder = {
    update: vi.fn((payload: Record<string, unknown>) => {
      calls.update = payload;
      return builder;
    }),
    eq,
    select: vi.fn().mockResolvedValue(result),
  };
  return { builder, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: 'dj-1' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startEvent', () => {
  test('issues one update carrying all five columns, filtered on id and status=upcoming', async () => {
    const { builder, calls } = tableDouble({ data: [{ id: EVENT_ID }], error: null });
    from.mockReturnValue(builder);

    const result = await startEvent(EVENT_ID, 'cocktails');

    expect(result).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('events');
    expect(calls.update).toMatchObject({
      status: 'live',
      phase: 'cocktails',
    });
    expect(calls.update).toHaveProperty('start_time');
    expect(calls.update).toHaveProperty('phase_started_at');
    expect(calls.update).toHaveProperty('join_token');
    expect(typeof calls.update?.join_token).toBe('string');
    expect((calls.update?.join_token as string)).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(calls.eq).toEqual([
      ['id', EVENT_ID],
      ['status', 'upcoming'],
    ]);
  });

  test('returns a wrong-state result, not a thrown error, when zero rows are updated', async () => {
    const { builder } = tableDouble({ data: [], error: null });
    from.mockReturnValue(builder);

    const result = await startEvent(EVENT_ID, 'cocktails');

    expect(result).toEqual({ ok: false, reason: 'wrong-state' });
  });

  test('writes start_time as Asia/Jerusalem wall clock, never the raw UTC substring', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T17:00:00.000Z'));

    const { builder, calls } = tableDouble({ data: [{ id: EVENT_ID }], error: null });
    from.mockReturnValue(builder);

    await startEvent(EVENT_ID, 'cocktails');

    expect(calls.update?.start_time).toBe('20:00');
  });
});

describe('setPhase', () => {
  test('writes phase and phase_started_at together, filtered on id and status=live', async () => {
    const { builder, calls } = tableDouble({ data: [{ id: EVENT_ID }], error: null });
    from.mockReturnValue(builder);

    const result = await setPhase(EVENT_ID, 'dinner');

    expect(result).toEqual({ ok: true });
    expect(calls.update).toMatchObject({ phase: 'dinner' });
    expect(calls.update).toHaveProperty('phase_started_at');
    expect(calls.eq).toEqual([
      ['id', EVENT_ID],
      ['status', 'live'],
    ]);
  });
});

const SUGGESTION_ID = '44444444-2222-4333-8444-555555555555';
const TRACK_ID = 'aaaaaaaaaaaaaaaaaaaaaa';

describe('playSuggestion', () => {
  test('calls dj_play_suggestion with the event and suggestion ids, maps a resolved row', async () => {
    rpc.mockResolvedValue({ data: [{ position: 3, was_already_played: false }], error: null });

    const result = await playSuggestion(EVENT_ID, SUGGESTION_ID);

    expect(rpc).toHaveBeenCalledWith('dj_play_suggestion', {
      p_event_id: EVENT_ID,
      p_suggestion_id: SUGGESTION_ID,
    });
    expect(result).toEqual({ ok: true, position: 3, wasAlreadyPlayed: false });
  });

  test('maps was_already_played through rather than hiding it', async () => {
    rpc.mockResolvedValue({ data: [{ position: 1, was_already_played: true }], error: null });

    const result = await playSuggestion(EVENT_ID, SUGGESTION_ID);

    expect(result).toEqual({ ok: true, position: 1, wasAlreadyPlayed: true });
  });

  test('returns a wrong-state result, not a thrown error, when the RPC raises event_not_live', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'event_not_live' } });

    const result = await playSuggestion(EVENT_ID, SUGGESTION_ID);

    expect(result).toEqual({ ok: false, reason: 'wrong-state' });
  });

  test('returns wrong-state when the RPC returns no row', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    const result = await playSuggestion(EVENT_ID, SUGGESTION_ID);

    expect(result).toEqual({ ok: false, reason: 'wrong-state' });
  });
});

describe('playPick', () => {
  test('calls dj_play_pick with title, artist and track id, maps a resolved row', async () => {
    rpc.mockResolvedValue({ data: [{ position: 2, was_already_played: false }], error: null });

    const result = await playPick(EVENT_ID, 'September', 'Earth, Wind & Fire', TRACK_ID);

    expect(rpc).toHaveBeenCalledWith('dj_play_pick', {
      p_event_id: EVENT_ID,
      p_title: 'September',
      p_artist: 'Earth, Wind & Fire',
      p_track_id: TRACK_ID,
    });
    expect(result).toEqual({ ok: true, position: 2, wasAlreadyPlayed: false });
  });

  test('within the 60-second window returns was_already_played:true without a second insert', async () => {
    rpc.mockResolvedValue({ data: [{ position: 2, was_already_played: true }], error: null });

    const result = await playPick(EVENT_ID, 'September', 'Earth, Wind & Fire', TRACK_ID);

    expect(result).toEqual({ ok: true, position: 2, wasAlreadyPlayed: true });
  });
});

describe('skipSuggestion', () => {
  test('sets status to skipped, filtered to this event and pending status, and nothing else', async () => {
    const { builder, calls } = tableDouble({ data: [{ id: SUGGESTION_ID }], error: null });
    from.mockReturnValue(builder);

    const result = await skipSuggestion(EVENT_ID, SUGGESTION_ID);

    expect(result).toEqual({ ok: true });
    expect(calls.update).toEqual({ status: 'skipped' });
    expect(calls.eq).toEqual([
      ['id', SUGGESTION_ID],
      ['event_id', EVENT_ID],
      ['status', 'pending'],
    ]);
  });

  test('returns wrong-state rather than silently re-skipping an already-played suggestion', async () => {
    const { builder } = tableDouble({ data: [], error: null });
    from.mockReturnValue(builder);

    const result = await skipSuggestion(EVENT_ID, SUGGESTION_ID);

    expect(result).toEqual({ ok: false, reason: 'wrong-state' });
  });
});
