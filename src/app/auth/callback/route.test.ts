import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * route.ts pulls in lib/supabase/server (next/headers), not importable from
 * jsdom (same reasoning as actions.test.ts) — mocked below so the real file
 * is never evaluated, and the exchange is fully test-doubled.
 */

const { exchangeCodeForSession } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

const supabaseClient = {
  auth: { exchangeCodeForSession },
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseClient),
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SITE_URL = 'http://localhost:3000';
  exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
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
