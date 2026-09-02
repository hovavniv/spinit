import { describe, expect, it, vi, beforeEach } from 'vitest';
import { topTagsByMbid } from './lastfm';

describe('lastfm', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.LASTFM_API_KEY = 'test-key';
  });

  it('queries by MBID, never by name, on the primary path', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ toptags: { tag: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await topTagsByMbid('mbid-1');
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain('mbid=mbid-1');
    expect(url).not.toContain('artist=');
  });

  it('treats an HTTP 200 carrying an `error` key as an ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: 8, message: 'operation failed' }),
                   { status: 200 })));
    await expect(topTagsByMbid('m')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('treats error 6 (not found) as EMPTY, not as an error — it is a real answer',
    async () => {
      vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: 6, message: 'not found' }), { status: 200 })));
      await expect(topTagsByMbid('m')).resolves.toEqual([]);
    });

  it('never puts the API key in an error message', async () => {
    process.env.LASTFM_API_KEY = 'SECRETKEY';
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{}', { status: 500 })));
    const err = await topTagsByMbid('m').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('SECRETKEY');
  });

  it('returns tags with their 0-100 counts unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ toptags: { tag: [
        { name: 'pop', count: 100 }, { name: 'Disco', count: 72 },
      ] } }), { status: 200 })));
    await expect(topTagsByMbid('m')).resolves.toEqual([
      { name: 'pop', count: 100 }, { name: 'Disco', count: 72 },
    ]);
  });

  it('coerces a string count to a number -- Last.fm sends strings on the wire', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ toptags: { tag: [
        { name: 'pop', count: '100' }, { name: 'disco', count: '72' },
      ] } }), { status: 200 })));
    await expect(topTagsByMbid('m')).resolves.toEqual([
      { name: 'pop', count: 100 }, { name: 'disco', count: 72 },
    ]);
  });

  it('a 200 with NO toptags key is an ERROR -- design §2.10 names this input', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ something: 'else' }), { status: 200 })));
    await expect(topTagsByMbid('m')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('unparseable JSON on a 200 is an ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response('<html>502</html>', { status: 200 })));
    await expect(topTagsByMbid('m')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('a 404 is an ERROR -- only error 6 is a not-found ANSWER', async () => {
    // Body is otherwise a well-formed, non-empty toptags success shape --
    // invalid in exactly one respect, the 404 status -- so this only passes
    // if the status is checked, not because a status-blind implementation
    // would ALSO reject an otherwise-empty/malformed body.
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ toptags: { tag: [] } }), { status: 404 })));
    await expect(topTagsByMbid('m')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
