import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const from = vi.fn();
const select = vi.fn();
const eq = vi.fn();

vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUser() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));
// react's `cache` memoises per request; a test calling listPartnerEvents
// twice would otherwise get the first call's result back both times.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, cache: (fn: unknown) => fn };
});

import { listPartnerEvents } from './partnerEventsDal';

/** A chainable builder: select/eq/order all return the same chain, awaited via .then(). */
function builder(result: { data: unknown[] | null; error: { code?: string; message: string } | null }) {
  const chain = {
    select,
    eq,
    order: vi.fn(() => chain),
    then: (resolve: (value: unknown) => void) => resolve(result),
  };
  select.mockReturnValue(chain);
  eq.mockReturnValue(chain);
  from.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: 'partner-1' });
});

describe('listPartnerEvents', () => {
  it('returns the events the user is a partner on', async () => {
    builder({
      data: [{ id: 'e1', couple_names: 'A & B', event_date: '2026-09-06' }],
      error: null,
    });

    await expect(listPartnerEvents()).resolves.toHaveLength(1);
  });

  it("returns [] for a user who is nobody's partner", async () => {
    builder({ data: [], error: null });

    await expect(listPartnerEvents()).resolves.toEqual([]);
  });

  it('orders by event date, with id as a tiebreaker', async () => {
    const chain = builder({ data: [], error: null });

    await listPartnerEvents();

    expect(chain.order).toHaveBeenNthCalledWith(1, 'event_date', { ascending: true });
    expect(chain.order).toHaveBeenNthCalledWith(2, 'id');
  });

  it('returns [] rather than throwing when the query errors', async () => {
    builder({ data: null, error: { code: '42501', message: 'denied' } });

    await expect(listPartnerEvents()).resolves.toEqual([]);
  });

  it('filters by the relationship, not by re-checking ownership', async () => {
    const chain = builder({ data: [], error: null });

    await listPartnerEvents();

    expect(chain.eq).toHaveBeenCalledWith('event_partners.user_id', 'partner-1');
    expect(chain.eq).not.toHaveBeenCalledWith('dj_id', expect.anything());
  });
});
