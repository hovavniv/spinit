import { describe, expect, it, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  process.env.SPOTIFY_CLIENT_ID = 'cid';
  process.env.SPOTIFY_CLIENT_SECRET = 'csec';
});

async function load() {
  return import('./appToken');
}

describe('appToken', () => {
  it('requests client_credentials and returns the token', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ access_token: 'T1', expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const { appToken } = await load();
    await expect(appToken()).resolves.toBe('T1');
    const body = (f.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain('grant_type=client_credentials');
  });

  it('sends the secret in a Basic header, never in the body', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ access_token: 'T1', expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const { appToken } = await load();
    await appToken();
    const init = f.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa('cid:csec')}`);
    expect(init.body as string).not.toContain('csec');
  });

  it('caches: a second call within the window does not refetch', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ access_token: 'T1', expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const { appToken } = await load();
    await appToken();
    await appToken();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('re-mints when the cached token is within 60s of expiry', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ access_token: 'T1', expires_in: 30 }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const { appToken } = await load();
    await appToken();
    await appToken();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('throws when the credentials are missing', async () => {
    delete process.env.SPOTIFY_CLIENT_ID;
    const { appToken } = await load();
    await expect(appToken()).rejects.toThrow(/SPOTIFY_CLIENT_ID/);
  });
});
