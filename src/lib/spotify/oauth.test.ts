import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeUrl, exchangeCode, refreshAccessToken, SPOTIFY_SCOPES } from './oauth';

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.SPOTIFY_CLIENT_ID = 'cid';
  process.env.SPOTIFY_CLIENT_SECRET = 'csec';
  process.env.SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:3000/api/spotify/callback';
});

describe('authorizeUrl', () => {
  it('requests exactly one scope', () => {
    expect(SPOTIFY_SCOPES).toEqual(['user-top-read']);
  });

  it('carries client_id, response_type=code, the redirect and the state', () => {
    const u = new URL(authorizeUrl('STATE123'));
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('STATE123');
    expect(u.searchParams.get('redirect_uri'))
      .toBe('http://127.0.0.1:3000/api/spotify/callback');
    expect(u.searchParams.get('scope')).toBe('user-top-read');
  });

  it('never puts the client secret in the URL', () => {
    expect(authorizeUrl('S')).not.toContain('csec');
  });
});

describe('exchangeCode', () => {
  it('sends the secret in a Basic header, not the body', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }),
      { status: 200 }));
    vi.stubGlobal('fetch', f);
    await exchangeCode('CODE');
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization)
      .toBe(`Basic ${btoa('cid:csec')}`);
    expect(init.body as string).not.toContain('csec');
    expect(init.body as string).toContain('grant_type=authorization_code');
  });

  it('throws on a non-200 WITHOUT leaking the response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{"error_description":"secret detail"}', { status: 400 })));

    let caught: unknown;
    try {
      await exchangeCode('BAD');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof Error) {
      expect(caught.message).not.toContain('secret detail');
      expect(caught.message).toContain('400');
    }
  });
});

describe('refreshAccessToken', () => {
  it('KEEPS THE OLD REFRESH TOKEN when the response omits one', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: 'A2', expires_in: 3600 }),
                   { status: 200 })));
    await expect(refreshAccessToken('OLD-R')).resolves.toMatchObject({
      accessToken: 'A2',
      refreshToken: 'OLD-R',
    });
  });

  it('takes the new refresh token when one IS returned', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: 'A2', refresh_token: 'NEW-R',
                                   expires_in: 3600 }), { status: 200 })));
    await expect(refreshAccessToken('OLD-R')).resolves.toMatchObject({
      refreshToken: 'NEW-R',
    });
  });
});
