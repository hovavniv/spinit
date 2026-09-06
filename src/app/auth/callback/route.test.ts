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
    // Sibling to the same-browser test below: an unrelated exchange error
    // code must NOT get the same-browser reason -- otherwise that branch
    // would be permanently-on regardless of which code arrived.
    expect(url.searchParams.get('error')).toBe('confirmation_failed');
  });

  it('gives a cross-device confirmation the same-browser reason, not the generic one', async () => {
    // A different device cannot supply the PKCE code verifier cookie
    // (design background: @supabase/ssr hardcodes flowType: "pkce"), so
    // exchangeCodeForSession returns this specific error code instead of
    // succeeding. The generic REASON_CONFIRMATION_FAILED tells this user to
    // "try signing up again", which fails (already registered) and burns
    // mailer quota -- REASON_SAME_BROWSER is the correct copy.
    exchangeCodeForSession.mockResolvedValueOnce({
      data: {},
      error: { message: 'code verifier missing', code: 'pkce_code_verifier_not_found' },
    });
    const request = new NextRequest('http://localhost:3000/auth/callback?code=used-elsewhere');

    const response = await GET(request);

    const location = response.headers.get('location');
    const url = new URL(location!);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('error')).toBe('confirmation_failed_same_browser');
    expect(location).not.toContain('code verifier missing');
    expect(location).not.toContain('pkce_code_verifier_not_found');
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
    // An ALREADY-CLAIMED partner: no owned events, one event_partners row.
    // Note what this fixture is NOT: a partner cannot look like this at the
    // moment they confirm their email, because the event_partners row is
    // written by claim_partner_slot, which runs afterwards on a button press.
    // This case is a re-confirmation or a later visit; the newly-confirmed
    // partner is covered by the user-metadata block below, and this fixture
    // passing was why that hole shipped unnoticed.
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

/**
 * The device-independent half of the invite handoff (2026-09-06).
 *
 * The bug these pin: a partner registers on a laptop, opens the confirmation
 * email on their phone, so no spinit_invite cookie is sent -- and the
 * event_partners fallback cannot identify them either, because the row that
 * would is only written by the claim they have not made yet. Every such
 * partner landed on the DJ dashboard.
 *
 * `getUser` is what supplies user_metadata here, matching route.ts reading it
 * off the same call it already makes for the id.
 */
describe('auth/callback — remembered invite on user metadata', () => {
  const invitePath = '/invite/3fa85f64-5717-4562-b3fc-2c963f66afa6/2';

  function signedInWith(metadata: Record<string, unknown>) {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', user_metadata: metadata } },
      error: null,
    });
  }

  it('routes a newly-confirmed partner to their invite when no cookie survived', async () => {
    // Exactly the production state at confirmation time: not a DJ, and no
    // event_partners row yet because the claim happens after this redirect.
    eventsLimit.mockResolvedValue({ data: [], error: null });
    partnersLimit.mockResolvedValue({ data: [], error: null });
    signedInWith({ invite_path: invitePath });
    const request = new NextRequest('http://localhost:3000/auth/callback?code=abc');

    const response = await GET(request);

    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe(invitePath);
  });

  it('still prefers the cookie when both are present', async () => {
    const cookiePath = '/invite/3fa85f64-5717-4562-b3fc-2c963f66afa6/1';
    cookieGet.mockImplementation((name: string) =>
      name === 'spinit_invite' ? { value: cookiePath } : undefined,
    );
    signedInWith({ invite_path: invitePath });
    const request = new NextRequest('http://localhost:3000/auth/callback?code=abc');

    const response = await GET(request);

    expect(new URL(response.headers.get('location')!).pathname).toBe(cookiePath);
  });

  it('sends an already-claimed partner to /my-event, not back to a claim page', async () => {
    // The metadata outlives the claim, so without the ordering in route.ts
    // this partner would be bounced to a claim that claim_partner_slot now
    // refuses, for ever.
    eventsLimit.mockResolvedValue({ data: [], error: null });
    partnersLimit.mockResolvedValue({ data: [{ id: 'link-1' }], error: null });
    signedInWith({ invite_path: invitePath });
    const request = new NextRequest('http://localhost:3000/auth/callback?code=abc');

    const response = await GET(request);

    expect(new URL(response.headers.get('location')!).pathname).toBe('/my-event');
  });

  it('sends a DJ to /dashboard even if metadata carries an invite path', async () => {
    eventsLimit.mockResolvedValue({ data: [{ id: 'event-1' }], error: null });
    partnersLimit.mockResolvedValue({ data: [], error: null });
    signedInWith({ invite_path: invitePath });
    const request = new NextRequest('http://localhost:3000/auth/callback?code=abc');

    const response = await GET(request);

    expect(new URL(response.headers.get('location')!).pathname).toBe('/dashboard');
  });

  it('refuses a forged metadata value, which auth.updateUser can set to anything', async () => {
    signedInWith({ invite_path: 'https://evil.com/steal' });
    const request = new NextRequest('http://localhost:3000/auth/callback?code=abc');

    const response = await GET(request);

    const location = response.headers.get('location');
    expect(location).not.toContain('evil.com');
    expect(new URL(location!).pathname).toBe('/dashboard');
  });

  it('falls through to /dashboard when metadata carries no invite path', async () => {
    // NOTE: this test would stay green even if invitePathFromMetadata
    // returned '/dashboard' instead of null for this input, because the
    // asserted pathname is /dashboard either way -- it does not itself pin
    // the null distinction. That distinction is pinned directly in
    // src/lib/auth/redirects.test.ts ('returns null, not /dashboard, when
    // there is nothing usable', line ~92-96).
    signedInWith({ full_name: 'A Partner', invite_path: '' });
    const request = new NextRequest('http://localhost:3000/auth/callback?code=abc');

    const response = await GET(request);

    expect(new URL(response.headers.get('location')!).pathname).toBe('/dashboard');
  });
});
