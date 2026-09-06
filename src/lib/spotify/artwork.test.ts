import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ---------------------------------------------------------------------------
   The endpoint SHAPES here are not invented: `GET /v1/tracks/{id}` and
   `GET /v1/artists/{id}` were both called live against the real API on
   2026-09-06 with this app's client credentials, and the responses carried
   `album.images` (widths 640/300/64) and `images` (640/320/160) respectively.
   Both BATCH forms (`?ids=`) returned 403 in the same run. CLAUDE.md's rule
   about hand-written fixtures for an API nobody has called applies directly:
   these fixtures mirror an observed response, not a remembered one.
   --------------------------------------------------------------------------- */

vi.mock('./appToken', () => ({
  appToken: vi.fn(async () => 'app-token'),
}));

const spotifyFetch = vi.fn(async (_endpoint: string, _token: string, _init?: RequestInit) => ({}) as unknown);
// Only `spotifyFetch` is replaced. The REAL `SpotifyError` is kept, because
// artwork.ts distinguishes a 429 from every other failure with `instanceof
// SpotifyError && err.kind === 'rate_limited'` -- a stand-in class would make
// that check pass against a lookalike and prove nothing about the real one.
vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return {
    ...actual,
    spotifyFetch: (endpoint: string, token: string, init?: RequestInit) =>
      spotifyFetch(endpoint, token, init),
  };
});

import { appToken } from './appToken';
import { SpotifyError } from './client';
import { resolveArtwork } from './artwork';

const TRACK = '748mdHapucXQri7IAO8yFK';
const ARTIST = '6S2OmqARrzebs0tKUEyXyp';

function trackResponse(url: string) {
  return { album: { images: [{ url: `${url}-640`, width: 640 }, { url, width: 64 }] } };
}

function artistResponse(url: string) {
  return { images: [{ url: `${url}-640`, width: 640 }, { url, width: 160 }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appToken).mockResolvedValue('app-token');
  // The rate-limit cooldown is module state that survives between tests, so a
  // test that trips it would silently make every LATER test a no-op. Wind the
  // clock past any cooldown a previous test set.
  vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveArtwork', () => {
  it('calls the SINGULAR endpoints, never the batch ones', async () => {
    // Both `?ids=` endpoints 403 for this app. A batch call would not fail
    // loudly -- every thumbnail would simply vanish -- so this is pinned.
    spotifyFetch.mockImplementation(async (endpoint: string) =>
      endpoint.startsWith('/tracks/') ? trackResponse('t.jpg') : artistResponse('a.jpg'),
    );

    await resolveArtwork({ trackIds: [TRACK], artistIds: [ARTIST] });

    const endpoints = spotifyFetch.mock.calls.map((call) => call[0]);
    expect(endpoints).toEqual([`/tracks/${TRACK}`, `/artists/${ARTIST}`]);
    for (const endpoint of endpoints) expect(endpoint).not.toContain('ids=');
  });

  it('keys by kind, so a track and an artist sharing an id do not collide', async () => {
    spotifyFetch.mockImplementation(async (endpoint: string) =>
      endpoint.startsWith('/tracks/') ? trackResponse('t.jpg') : artistResponse('a.jpg'),
    );

    const map = await resolveArtwork({ trackIds: [TRACK], artistIds: [TRACK] });

    expect(map).toEqual({ [`track:${TRACK}`]: 't.jpg', [`artist:${TRACK}`]: 'a.jpg' });
  });

  it('picks the smallest image at least 64px wide, not the largest', async () => {
    spotifyFetch.mockResolvedValue(trackResponse('small.jpg'));

    const map = await resolveArtwork({ trackIds: [TRACK], artistIds: [] });

    expect(map[`track:${TRACK}`]).toBe('small.jpg');
  });

  it('requests each distinct id once', async () => {
    spotifyFetch.mockResolvedValue(trackResponse('t.jpg'));

    await resolveArtwork({ trackIds: [TRACK, TRACK, TRACK], artistIds: [] });

    expect(spotifyFetch).toHaveBeenCalledTimes(1);
  });

  it('skips null and empty ids rather than requesting them', async () => {
    spotifyFetch.mockResolvedValue(trackResponse('t.jpg'));

    await resolveArtwork({ trackIds: [null, undefined, '', TRACK], artistIds: [null] });

    expect(spotifyFetch).toHaveBeenCalledTimes(1);
    expect(spotifyFetch.mock.calls[0][0]).toBe(`/tracks/${TRACK}`);
  });

  it('caps the number of requests one page render can make', async () => {
    spotifyFetch.mockResolvedValue(trackResponse('t.jpg'));
    const many = Array.from({ length: 60 }, (_, i) => `id${i}`.padEnd(22, 'x'));

    await resolveArtwork({ trackIds: many, artistIds: [] });

    expect(spotifyFetch.mock.calls.length).toBeLessThanOrEqual(24);
  });

  it('opts into caching explicitly — `revalidate` alone would be dropped', async () => {
    // Next ignores BOTH options when they conflict (`{revalidate, cache:'no-store'}`),
    // and spotifyFetch defaults to 'no-store'. Without `cache: 'force-cache'`
    // every page load would re-request every thumbnail and nothing would say so.
    spotifyFetch.mockResolvedValue(trackResponse('t.jpg'));

    await resolveArtwork({ trackIds: [TRACK], artistIds: [] });

    const init = spotifyFetch.mock.calls[0][2] as RequestInit & { next?: { revalidate?: number } };
    expect(init.cache).toBe('force-cache');
    expect(init.next?.revalidate).toBeGreaterThan(0);
  });

  it('returns the OTHER rows when one id fails', async () => {
    spotifyFetch.mockImplementation(async (endpoint: string) => {
      if (endpoint === `/tracks/${TRACK}`) throw new Error('429');
      return artistResponse('a.jpg');
    });

    const map = await resolveArtwork({ trackIds: [TRACK], artistIds: [ARTIST] });

    expect(map).toEqual({ [`artist:${ARTIST}`]: 'a.jpg' });
  });

  it('returns {} rather than throwing when no token can be obtained', async () => {
    // A missing SPOTIFY_CLIENT_ID must cost the page its thumbnails, not the page.
    vi.mocked(appToken).mockRejectedValue(new Error('SPOTIFY_CLIENT_ID is not set'));

    await expect(resolveArtwork({ trackIds: [TRACK], artistIds: [] })).resolves.toEqual({});
    expect(spotifyFetch).not.toHaveBeenCalled();
  });

  it('omits an id whose response carries no images at all', async () => {
    spotifyFetch.mockResolvedValue({ album: { images: [] } });

    const map = await resolveArtwork({ trackIds: [TRACK], artistIds: [] });

    expect(map).toEqual({});
  });

  it('makes no request at all when there is nothing to resolve', async () => {
    const map = await resolveArtwork({ trackIds: [], artistIds: [] });

    expect(map).toEqual({});
    expect(appToken).not.toHaveBeenCalled();
  });
});

describe('resolveArtwork under a rate limit', () => {
  function rateLimited() {
    return new SpotifyError('rate_limited', 429, '/tracks/x');
  }

  it('abandons the rest of the batch on the first 429 instead of asking 20 more times', async () => {
    // /tracks/{id} and /artists/{id} share a quota that /search does not. Once
    // it is exhausted every remaining id is certain to 429 too, and each one
    // costs spotifyFetch's retry sleep AND deepens the throttle. Observed live
    // on 2026-09-06 at Retry-After: 649 (~11 minutes).
    vi.setSystemTime(new Date('2030-02-01T00:00:00Z'));
    spotifyFetch.mockRejectedValue(rateLimited());
    const many = Array.from({ length: 20 }, (_, i) => `id${i}`.padEnd(22, 'x'));

    const map = await resolveArtwork({ trackIds: many, artistIds: [] });

    expect(map).toEqual({});
    // At most one per worker: the in-flight ones finish, the queue stops.
    expect(spotifyFetch.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('makes NO request at all on the next render while the cooldown holds', async () => {
    // Next's Data Cache stores 200s only, so without this every throttled id
    // is re-requested on every single page load -- which is what dug the hole.
    vi.setSystemTime(new Date('2030-03-01T00:00:00Z'));
    spotifyFetch.mockRejectedValue(rateLimited());
    await resolveArtwork({ trackIds: [TRACK], artistIds: [] });
    spotifyFetch.mockClear();

    const map = await resolveArtwork({ trackIds: [TRACK], artistIds: [ARTIST] });

    expect(map).toEqual({});
    expect(spotifyFetch).not.toHaveBeenCalled();
  });

  it('resumes once the cooldown has passed', async () => {
    vi.setSystemTime(new Date('2030-04-01T00:00:00Z'));
    spotifyFetch.mockRejectedValue(rateLimited());
    await resolveArtwork({ trackIds: [TRACK], artistIds: [] });

    vi.setSystemTime(new Date('2030-04-01T00:05:00Z'));
    spotifyFetch.mockReset();
    spotifyFetch.mockResolvedValue(trackResponse('t.jpg'));

    const map = await resolveArtwork({ trackIds: [TRACK], artistIds: [] });

    expect(map).toEqual({ [`track:${TRACK}`]: 't.jpg' });
  });

  it('does NOT start a cooldown for an ordinary failure', async () => {
    // A 404 on one deleted track must not cost every other row its thumbnail
    // for the next minute.
    vi.setSystemTime(new Date('2030-05-01T00:00:00Z'));
    spotifyFetch.mockRejectedValueOnce(new SpotifyError('unavailable', 404, '/tracks/x'));
    spotifyFetch.mockResolvedValue(artistResponse('a.jpg'));

    const map = await resolveArtwork({ trackIds: [TRACK], artistIds: [ARTIST] });

    expect(map).toEqual({ [`artist:${ARTIST}`]: 'a.jpg' });
  });
});
