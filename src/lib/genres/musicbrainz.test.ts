import { describe, expect, it, vi, beforeEach } from 'vitest';
import { englishAliasFor, mbidForSpotifyArtist } from './musicbrainz';

const UA = /^Spinit\/[\d.]+ \( https:\/\/github\.com\/hovavniv\/spinit \)$/;

describe('musicbrainz', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a User-Agent — MusicBrainz BLOCKS requests without one', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ relations: [] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await mbidForSpotifyArtist('0LcJLqbBmaGUft1e9Mm8HV');
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(UA);
  });

  it('normalises the Spotify URL before asking — an intl- segment breaks exact match',
    async () => {
      const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ relations: [] }), { status: 200 }));
      vi.stubGlobal('fetch', f);
      await mbidForSpotifyArtist('0LcJLqbBmaGUft1e9Mm8HV');
      expect(String(f.mock.calls[0][0]))
        .toContain(encodeURIComponent('https://open.spotify.com/artist/0LcJLqbBmaGUft1e9Mm8HV'));
    });

  it('treats a 503 as an ERROR even when the body is a perfectly good response', async () => {
    // The body is deliberately VALID -- a real relation, correctly shaped.
    // The ONLY thing wrong is the status code, so this is invalid in
    // exactly one way: a status-blind implementation would parse this body,
    // find a good relation, and return the MBID instead of throwing. An
    // earlier draft used `{ error: 'currently busy' }`, which is ALSO
    // missing the `relations` key -- invalid twice -- so the missing-key
    // check caught it independently and the test passed whether or not the
    // status was ever read.
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ relations: [{
        type: 'free streaming',
        url: { resource: 'https://open.spotify.com/artist/0LcJLqbBmaGUft1e9Mm8HV' },
        artist: { id: 'b1e2c3d4-0000-4000-8000-000000000001' },
      }] }), { status: 503 }));
    vi.stubGlobal('fetch', f);
    await expect(mbidForSpotifyArtist('0LcJLqbBmaGUft1e9Mm8HV'))
      .rejects.toMatchObject({ kind: 'unavailable' });
    // A persistent 503 must terminate as an error, not retry forever --
    // exactly two attempts (the one retry mbFetch allows), then throw.
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a 200 with a malformed body (no relations key) is an ERROR', async () => {
    // Invalid in exactly one way: a valid status, a body that is not the
    // shape asked for. Keeps this check pinned separately from the 503
    // status check above, now that neither fixture is invalid twice.
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: 'currently busy' }), { status: 200 })));
    await expect(mbidForSpotifyArtist('x')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('returns the MBID from a real spotify relation', async () => {
    // The happy path. Without it, every other test in this file passes against
    // an implementation that returns null unconditionally.
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ relations: [{
        type: 'free streaming',
        url: { resource: 'https://open.spotify.com/artist/0LcJLqbBmaGUft1e9Mm8HV' },
        artist: { id: 'b1e2c3d4-0000-4000-8000-000000000001' },
      }] }), { status: 200 })));
    await expect(mbidForSpotifyArtist('0LcJLqbBmaGUft1e9Mm8HV'))
      .resolves.toBe('b1e2c3d4-0000-4000-8000-000000000001');
  });

  it('returns null — not an error — when the artist genuinely has no link', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ relations: [] }), { status: 200 })));
    await expect(mbidForSpotifyArtist('x')).resolves.toBeNull();
  });

  it('picks the primary English "Artist name" alias, not sort-name', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        'sort-name': 'Adam, Omer',
        aliases: [
          { name: 'Omer Adam', locale: 'en', primary: true, type: 'Artist name' },
          { name: 'O. Adam', locale: 'en', primary: false, type: 'Artist name' },
        ],
      }), { status: 200 })));
    await expect(englishAliasFor('mbid-1')).resolves.toBe('Omer Adam');
  });

  it('returns null rather than falling back to sort-name, which is surname-first',
    async () => {
      vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ 'sort-name': 'Adam, Omer', aliases: [] }),
                     { status: 200 })));
      await expect(englishAliasFor('mbid-1')).resolves.toBeNull();
    });

  it('a 200 with NO relations key is an ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ something: 'else' }), { status: 200 })));
    await expect(mbidForSpotifyArtist('x')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('unparseable JSON on a 200 is an ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response('<html>502</html>', { status: 200 })));
    await expect(mbidForSpotifyArtist('x')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('a 404 is an ERROR', async () => {
    // A valid, well-shaped body (empty relations, same as the "no link"
    // success case) -- invalid in exactly one way, the status code, so a
    // status-blind implementation would resolve null instead of throwing.
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ relations: [] }), { status: 404 })));
    await expect(mbidForSpotifyArtist('x')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
