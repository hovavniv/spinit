import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * connectSpotify pulls in lib/supabase/server (next/headers), lib/auth/dal
 * (import 'server-only'), next/navigation's redirect and next/headers'
 * cookies — none importable as-is from jsdom. All are mocked below so the
 * real modules are never evaluated.
 */

const { requireUser, redirect, cookieSet, single, eq, from } = vi.hoisted(() => {
  const cookieSet = vi.fn();
  const single = vi.fn();
  const eq = vi.fn(() => ({ single }));
  const from = vi.fn(() => ({ select: vi.fn(() => ({ eq })) }));
  return {
    requireUser: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;push;${url};307;` });
    }),
    cookieSet,
    single,
    eq,
    from,
  };
});

vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUser() }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: cookieSet })),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));
vi.mock('./oauth', () => ({
  authorizeUrl: (state: string) => `https://accounts.spotify.com/authorize?state=${state}`,
}));

import { connectSpotify } from './actions';

/** partnerId is the only field the form action reads. */
function form(partnerId: string): FormData {
  const data = new FormData();
  data.append('partnerId', partnerId);
  return data;
}

describe('connectSpotify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: 'user-partner-1' });
    single.mockResolvedValue({ data: { user_id: 'user-partner-1' }, error: null });
  });

  it('refuses a caller who is not that partner', async () => {
    requireUser.mockResolvedValue({ id: 'someone-else' });
    await expect(connectSpotify(form('p1'))).rejects.toThrow();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('sets an httpOnly, SameSite=Lax cookie carrying state and partnerId', async () => {
    await expect(connectSpotify(form('p1'))).rejects.toThrow();
    const [name, value, opts] = cookieSet.mock.calls[0];
    expect(name).toBe('spotify_oauth');
    expect(opts).toMatchObject({ httpOnly: true, sameSite: 'lax', maxAge: 600 });
    expect(JSON.parse(value)).toMatchObject({ partnerId: 'p1' });
  });

  it('uses SameSite=Lax, not Strict — Strict breaks the cross-site return', async () => {
    await expect(connectSpotify(form('p1'))).rejects.toThrow();
    expect(cookieSet.mock.calls[0][2].sameSite).not.toBe('strict');
  });

  it('redirects to an authorize URL whose state matches the cookie', async () => {
    await expect(connectSpotify(form('p1'))).rejects.toThrow();
    const cookieState = JSON.parse(cookieSet.mock.calls[0][1]).state;
    expect(new URL(redirect.mock.calls[0][0]).searchParams.get('state')).toBe(cookieState);
  });
});
