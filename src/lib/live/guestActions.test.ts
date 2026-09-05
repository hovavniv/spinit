import { describe, expect, it, vi, beforeEach } from 'vitest';

const { rpc, cookieSet, cookieGet } = vi.hoisted(() => ({
  rpc: vi.fn(),
  cookieSet: vi.fn(),
  cookieGet: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: cookieSet, get: cookieGet })),
}));

import { joinAction, suggestAction, voteAction } from './guestActions';

const TOKEN = 'a'.repeat(22);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TRACK_ID = 'x'.repeat(22);

beforeEach(() => {
  vi.clearAllMocks();
  // suggestAction/voteAction (F3) read the session id off the cookie, keyed
  // by TOKEN -- most tests below act as a guest who has already joined.
  cookieGet.mockReturnValue({ value: SESSION_ID });
});

describe('joinAction', () => {
  it('rejects a blank name before ever calling the RPC', async () => {
    const result = await joinAction(TOKEN, '   ');
    expect(result).toEqual({ ok: false, code: 'invalid', message: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sets the guest session cookie on success, and never returns the session id to the caller', async () => {
    rpc.mockResolvedValue({ data: SESSION_ID, error: null });

    const result = await joinAction(TOKEN, 'Table 7');

    // The cookie -- set server-side, above -- is the only place this id
    // should ever live. Returning it in the action's result would put it in
    // a resolved Server Action value, reachable by client script exactly
    // like a prop would be (F3's third call site).
    expect(result).toEqual({ ok: true });
    expect(result).not.toHaveProperty('sessionId');
    expect(cookieSet).toHaveBeenCalledWith(`spinit_guest_${TOKEN}`, SESSION_ID, expect.anything());
  });

  it('maps event_not_live to the not-live copy and sets no cookie', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'event_not_live' } });

    const result = await joinAction(TOKEN, 'Table 7');

    expect(result).toEqual({
      ok: false,
      code: 'event_not_live',
      message: "This event hasn't started yet, or it's over.",
    });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe('suggestAction', () => {
  it('returns wasExisting from the RPC row', async () => {
    rpc.mockResolvedValue({ data: [{ suggestion_id: 'sug-1', was_existing: true }], error: null });

    const result = await suggestAction(TOKEN, TRACK_ID, 'September', 'Earth, Wind & Fire');

    expect(result).toEqual({ ok: true, suggestionId: 'sug-1', wasExisting: true });
  });

  it('maps suggestion_limit', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'suggestion_limit' } });

    const result = await suggestAction(TOKEN, TRACK_ID, 'September', 'Earth, Wind & Fire');

    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe('suggestion_limit');
  });

  it('rejects an oversized title before calling the RPC', async () => {
    const result = await suggestAction(TOKEN, TRACK_ID, 'x'.repeat(201), 'Artist');
    expect(result).toEqual({ ok: false, code: 'invalid', message: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
  });

  // F3: reads the session id off the cookie server-side, keyed by TOKEN --
  // never trusts a caller-supplied session id, because there is none to
  // supply any more.
  it('reads the session id from the cookie, keyed by the token, not from any argument', async () => {
    rpc.mockResolvedValue({ data: [{ suggestion_id: 'sug-1', was_existing: false }], error: null });

    await suggestAction(TOKEN, TRACK_ID, 'September', 'Earth, Wind & Fire');

    expect(cookieGet).toHaveBeenCalledWith(`spinit_guest_${TOKEN}`);
    expect(rpc).toHaveBeenCalledWith(
      'guest_suggest',
      expect.objectContaining({ p_session_id: SESSION_ID }),
    );
  });

  it('fails with no_such_session, and never calls the RPC, when the cookie is missing', async () => {
    cookieGet.mockReturnValue(undefined);

    const result = await suggestAction(TOKEN, TRACK_ID, 'September', 'Earth, Wind & Fire');

    expect(result).toEqual({
      ok: false,
      code: 'no_such_session',
      message: expect.any(String),
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('voteAction', () => {
  it('calls guest_vote with the session (from the cookie) and suggestion ids', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const suggestionId = '22222222-2222-4222-8222-222222222222';

    const result = await voteAction(TOKEN, suggestionId);

    expect(result).toEqual({ ok: true });
    expect(cookieGet).toHaveBeenCalledWith(`spinit_guest_${TOKEN}`);
    expect(rpc).toHaveBeenCalledWith('guest_vote', {
      p_session_id: SESSION_ID,
      p_suggestion_id: suggestionId,
    });
  });

  it('maps wrong_event', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'wrong_event' } });

    const result = await voteAction(TOKEN, '22222222-2222-4222-8222-222222222222');

    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe('wrong_event');
  });

  it('fails with no_such_session, and never calls the RPC, when the cookie is missing', async () => {
    cookieGet.mockReturnValue(undefined);

    const result = await voteAction(TOKEN, '22222222-2222-4222-8222-222222222222');

    expect(result).toEqual({
      ok: false,
      code: 'no_such_session',
      message: expect.any(String),
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
