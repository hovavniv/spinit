import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));

import { claimPartnerSlot } from './partnersDal';

const EVENT = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  rpc.mockReset();
});

describe('claimPartnerSlot', () => {
  it('calls the function with the event and slot', async () => {
    rpc.mockResolvedValue({ data: 'p1', error: null });

    await expect(claimPartnerSlot(EVENT, 1)).resolves.toBe('p1');
    expect(rpc).toHaveBeenCalledWith('claim_partner_slot', {
      p_event: EVENT,
      p_slot: 1,
    });
  });

  it('returns null on 42501 rather than throwing, and leaks nothing', async () => {
    // The function raises 42501 for every refusal -- no such event, already
    // claimed, not your invitation -- so the caller cannot tell them apart.
    // Surfacing the error text here would undo that.
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'no matching invitation' },
    });

    await expect(claimPartnerSlot(EVENT, 2)).resolves.toBeNull();
  });

  it('returns null when the function somehow returns no id', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await expect(claimPartnerSlot(EVENT, 1)).resolves.toBeNull();
  });
});
