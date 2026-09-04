import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const requireUser = vi.fn();
const revalidatePath = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUser() }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));

import { startEvent, setPhase } from './liveActions';

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
