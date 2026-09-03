import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * route.ts pulls in lib/supabase/server (next/headers), not importable from
 * jsdom (same reasoning as actions.test.ts) — mocked below so the real file
 * is never evaluated, and the exchange is fully test-doubled.
 */

const { exchangeCodeForSession, getUser, eventsLimit, partnersLimit, from, cookieGet, cookieDelete } =
  vi.hoisted(() => {
    const eventsLimit = vi.fn();
    const partnersLimit = vi.fn();
    const limitByTable: Record<string, typeof eventsLimit> = {
      events: eventsLimit,
      event_partners: partnersLimit,
    };
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ limit: limitByTable[table] })) })),
    }));
    return {
      exchangeCodeForSession: vi.fn(),
      getUser: vi.fn(),
      eventsLimit,
      partnersLimit,
      from,
      cookieGet: vi.fn(),
      cookieDelete: vi.fn(),
    };
  });

const supabaseClient = {
  auth: { exchangeCodeForSession, getUser },
  from,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseClient),
}));

// The invite cookie (plan task 14 / design §4.7-§4.8). Same shape as the
// spotify/callback route's own next/headers double (src/app/api/spotify/
// callback/route.test.ts) -- a plain get/delete pair backed by hoisted
// vi.fn()s, not a real cookie jar.
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => cookieGet(name),
    delete: (name: string) => cookieDelete(name),
  })),
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SITE_URL = 'http://localhost:3000';
  exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  cookieGet.mockReturnValue(undefined);
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  eventsLimit.mockResolvedValue({ data: [], error: null });
  partnersLimit.mockResolvedValue({ data: [], error: null });
});

describe('auth/callback — open-redirect control', () => {
  it('redirects to /dashboard, never to an attacker-controlled next value', async () => {
    const request = new NextRequest(
      'http://localhost:3000/auth/callback?code=abc&next=https://evil.com',
    );

    const response = await GET(request);

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    expect(location).not.toContain('evil.com');
    expect(new URL(location!).pathname).toBe('/dashboard');
  });
});

describe('auth/callback — failure branch', () => {
  it('redirects to /login with a fixed internal reason, never the remote error_description', async () => {
    const request = new NextRequest(
      'http://localhost:3000/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );

    const response = await GET(request);

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    const url = new URL(location!);
    expect(url.pathname).toBe('/login');
    expect(location).not.toContain('expired');
    expect(location).not.toContain('Email+link');
    expect(location).not.toContain('error_description');
  });

  it('maps bad_code_verifier to a distinguishable reason code, still with no remote text', async () => {
    const request = new NextRequest(
      'http://localhost:3000/auth/callback?error=access_denied&error_code=bad_code_verifier&error_description=some+remote+text',
    );

    const response = await GET(request);

    const location = response.headers.get('location');
    const url = new URL(location!);
    expect(url.pathname).toBe('/login');
    expect(location).not.toContain('remote');
    const otherRequest = new NextRequest(
      'http://localhost:3000/auth/callback?error=access_denied&error_code=otp_expired',
    );
    const otherResponse = await GET(otherRequest);
    const otherLocation = otherResponse.headers.get('location');

    // bad_code_verifier / flow_state_not_found map to a DIFFERENT reason
    // code than a plain expired/otp_expired link (design gap 10).
    expect(url.searchParams.get('error')).not.toBe(
      new URL(otherLocation!).searchParams.get('error'),
    );
  });

  it('redirects to /login when exchangeCodeForSession itself returns an error', async () => {
    exchangeCodeForSession.mockResolvedValueOnce({
      data: {},
      error: { message: 'invalid grant', code: 'invalid_grant' },
    });
    const request = new NextRequest('http://localhost:3000/auth/callback?code=used-already');

    const response = await GET(request);

    const location = response.headers.get('location');
    const url = new URL(location!);
    expect(url.pathname).toBe('/login');
    expect(location).not.toContain('invalid grant');
  });

  it('redirects to /login when code is absent and no error params are present', async () => {
    const request = new NextRequest('http://localhost:3000/auth/callback');

    const response = await GET(request);

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    const location = response.headers.get('location');
    const url = new URL(location!);
    expect(url.pathname).toBe('/login');
  });

  it('redirects to /login and never calls exchangeCodeForSession when code AND error are both present', async () => {
    // A mutation removing the `error || errorCode` terms from the guard
    // (leaving only `!code`) would still pass every other test in this
    // file, because none of them send `code` and `error` together — this is
    // the actual security-relevant combination (an attacker or a buggy
    // redirect sending both). `error`/`error_code` must take precedence.
    const request = new NextRequest(
      'http://localhost:3000/auth/callback?code=abc&error=access_denied&error_code=otp_expired',
    );

    const response = await GET(request);

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    const url = new URL(location!);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('error')).toBeTruthy();
  });
});

describe('auth/callback — invite cookie (plan task 14 / design §4.7-§4.8)', () => {
  it('honours a valid invite cookie and clears it', async () => {
    const invitePath = '/invite/3fa85f64-5717-4562-b3fc-2c963f66afa6/1';
    cookieGet.mockImplementation((name: string) =>
      name === 'spinit_invite' ? { value: invitePath } : undefined,
    );
    const request = new NextRequest('http://localhost:3000/auth/callback?code=abc');

    const response = await GET(request);

    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe(invitePath);
    expect(cookieDelete).toHaveBeenCalledWith('spinit_invite');
  });

  it('falls back to postLoginPath, not the literal /dashboard, when no cookie is present', async () => {
    // A partner: no owned events, one event_partners row.
    eventsLimit.mockResolvedValue({ data: [], error: null });
    partnersLimit.mockResolvedValue({ data: [{ id: 'link-1' }], error: null });
    const request = new NextRequest('http://localhost:3000/auth/callback?code=abc');

    const response = await GET(request);

    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe('/my-event');
  });

  it('ignores a tampered/invalid cookie value and falls back to /dashboard', async () => {
    cookieGet.mockImplementation((name: string) =>
      name === 'spinit_invite' ? { value: '//evil.com' } : undefined,
    );
    const request = new NextRequest('http://localhost:3000/auth/callback?code=abc');

    const response = await GET(request);

    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe('/dashboard');
    // Consumed once regardless -- a stale invitation must not hijack the
    // next unrelated signup in the same browser.
    expect(cookieDelete).toHaveBeenCalledWith('spinit_invite');
  });

  it('never reads the invite cookie before the exchange succeeds', async () => {
    exchangeCodeForSession.mockResolvedValueOnce({
      data: {},
      error: { message: 'invalid grant', code: 'invalid_grant' },
    });
    const request = new NextRequest('http://localhost:3000/auth/callback?code=used-already');

    const response = await GET(request);

    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe('/login');
    expect(cookieGet).not.toHaveBeenCalled();
    expect(cookieDelete).not.toHaveBeenCalled();
  });
});
