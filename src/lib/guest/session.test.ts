import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Pins the guest session cookie's shape (design §4.5). Real Next cookie
 * flags (httpOnly, sameSite, path, maxAge, secure-in-production-only) fail
 * completely silently if dropped -- CLAUDE.md's own supabase/server.ts
 * precedent -- so this asserts the exact options object passed to the
 * mocked `cookies()` API rather than trusting a manual read.
 */

const { cookieSet, cookieGet, cookieDelete } = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookieGet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: cookieSet,
    get: cookieGet,
    delete: cookieDelete,
  })),
}));

const TOKEN = 'a'.repeat(22);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setGuestSessionCookie', () => {
  it('sets spinit_guest_<token>, not spinit_guest_<eventId> or any other name', async () => {
    const { setGuestSessionCookie } = await import('./session');
    await setGuestSessionCookie(TOKEN, 'session-uuid-1');

    expect(cookieSet).toHaveBeenCalledWith(`spinit_guest_${TOKEN}`, 'session-uuid-1', expect.anything());
  });

  it('sets httpOnly, sameSite lax, path /join, and a 12-hour maxAge', async () => {
    const { setGuestSessionCookie } = await import('./session');
    await setGuestSessionCookie(TOKEN, 'session-uuid-1');

    const [, , options] = cookieSet.mock.calls[0];
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/join',
      maxAge: 12 * 60 * 60,
    });
  });

  it('sets secure only in production', async () => {
    const original = process.env.NODE_ENV;
    const { setGuestSessionCookie } = await import('./session');

    // @ts-expect-error -- NODE_ENV is readonly in the type, writable at runtime
    process.env.NODE_ENV = 'development';
    await setGuestSessionCookie(TOKEN, 'session-uuid-1');
    expect(cookieSet.mock.calls[0][2].secure).toBe(false);

    // @ts-expect-error -- see above
    process.env.NODE_ENV = 'production';
    await setGuestSessionCookie(TOKEN, 'session-uuid-1');
    expect(cookieSet.mock.calls[1][2].secure).toBe(true);

    // @ts-expect-error -- see above
    process.env.NODE_ENV = original;
  });
});

describe('getGuestSessionId', () => {
  it('reads the value off spinit_guest_<token>', async () => {
    cookieGet.mockReturnValue({ value: 'session-uuid-1' });
    const { getGuestSessionId } = await import('./session');

    const id = await getGuestSessionId(TOKEN);

    expect(cookieGet).toHaveBeenCalledWith(`spinit_guest_${TOKEN}`);
    expect(id).toBe('session-uuid-1');
  });

  it('returns null when the cookie is absent', async () => {
    cookieGet.mockReturnValue(undefined);
    const { getGuestSessionId } = await import('./session');

    expect(await getGuestSessionId(TOKEN)).toBeNull();
  });
});

describe('clearGuestSessionCookie', () => {
  it('deletes spinit_guest_<token> at path /join', async () => {
    const { clearGuestSessionCookie } = await import('./session');

    await clearGuestSessionCookie(TOKEN);

    expect(cookieDelete).toHaveBeenCalledWith(
      expect.objectContaining({ name: `spinit_guest_${TOKEN}`, path: '/join' }),
    );
  });
});
