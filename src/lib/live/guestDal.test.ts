import { describe, expect, it, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));

import { readGuestEvent, readGuestQueue } from './guestDal';

const TOKEN = 'a'.repeat(22);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readGuestEvent', () => {
  it('returns coupleNames and isLive on success', async () => {
    rpc.mockResolvedValue({ data: [{ couple_names: 'Dana & Yossi', is_live: true }], error: null });

    const result = await readGuestEvent(TOKEN);

    expect(result).toEqual({ ok: true, data: { coupleNames: 'Dana & Yossi', isLive: true } });
  });

  it('maps no_such_event', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'no_such_event' } });

    const result = await readGuestEvent(TOKEN);

    expect(result).toEqual({ ok: false, code: 'no_such_event', message: "That link isn't valid." });
  });
});

describe('readGuestQueue', () => {
  it("reads usedCount from the RPC's own used_count column, not from queue.length", async () => {
    rpc.mockResolvedValue({
      data: [
        { suggestion_id: 's1', title: 'A', artist: 'B', votes: 1, voted: false, mine: true, used_count: 3 },
      ],
      error: null,
    });

    const result = await readGuestQueue(SESSION_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.usedCount).toBe(3);
      expect(result.data.queue).toHaveLength(1);
    }
  });

  it('does not re-sort the rows the RPC returns', async () => {
    rpc.mockResolvedValue({
      data: [
        { suggestion_id: 's2', title: 'Second', artist: 'B', votes: 1, voted: false, mine: false, used_count: 0 },
        { suggestion_id: 's1', title: 'First', artist: 'A', votes: 99, voted: false, mine: false, used_count: 0 },
      ],
      error: null,
    });

    const result = await readGuestQueue(SESSION_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.queue.map((r) => r.suggestionId)).toEqual(['s2', 's1']);
    }
  });

  it('maps no_such_session', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'no_such_session' } });

    const result = await readGuestQueue(SESSION_ID);

    expect(result).toEqual({
      ok: false,
      code: 'no_such_session',
      message: expect.any(String),
    });
  });
});
