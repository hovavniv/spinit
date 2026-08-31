import { describe, expect, it, vi, beforeEach } from 'vitest';
import { spotifyFetch, SpotifyError } from './client';

beforeEach(() => vi.restoreAllMocks());

describe('spotifyFetch', () => {
  it('returns parsed json on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
    await expect(spotifyFetch('/x', 'tok')).resolves.toEqual({ ok: 1 });
  });

  it('sends the bearer token', async () => {
    const f = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await spotifyFetch('/x', 'tok');
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('retries once on 429 and honours Retry-After', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 2 }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await expect(spotifyFetch('/x', 'tok')).resolves.toEqual({ ok: 2 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('throws a typed rate_limited error when the retry also 429s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('', { status: 429, headers: { 'Retry-After': '0' } })));
    await expect(spotifyFetch('/x', 'tok')).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('throws a typed forbidden error on 403, which is the allowlist case', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    await expect(spotifyFetch('/x', 'tok')).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('never puts the response body in the error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"error":{"message":"secret detail"}}', { status: 500 })));
    await expect(spotifyFetch('/x', 'tok')).rejects.toThrow(
      expect.not.stringContaining('secret detail') as unknown as string,
    );
  });
});
