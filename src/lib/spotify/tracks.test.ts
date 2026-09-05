import { describe, expect, it, vi, beforeEach } from 'vitest';

const spotifyFetch = vi.fn(async (_path: string, _token: string) => ({}) as unknown);
const appToken = vi.fn(async () => 'app-token');

vi.mock('./client', () => ({
  spotifyFetch: (...args: [string, string]) => spotifyFetch(...args),
  SpotifyError: class SpotifyError extends Error {
    constructor(
      readonly kind: string,
      readonly status: number,
      readonly endpoint: string,
    ) {
      super(`spotify ${kind} (${status}) on ${endpoint}`);
    }
  },
}));
vi.mock('./appToken', () => ({ appToken: () => appToken() }));

import { getTrack, resolveTracks } from './tracks';
import { SpotifyError } from './client';

function rawTrack(id: string, title: string, artists: { id: string; name: string }[]) {
  return { id, name: title, artists };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getTrack', () => {
  it('returns title, the first artist, and a full artists list', async () => {
    spotifyFetch.mockResolvedValue(
      rawTrack('trackaaaaaaaaaaaaaaaaa', 'September', [
        { id: 'artist1aaaaaaaaaaaaaaa', name: 'Earth, Wind & Fire' },
      ]),
    );

    const result = await getTrack('trackaaaaaaaaaaaaaaaaa');

    expect(result).toEqual({
      id: 'trackaaaaaaaaaaaaaaaaa',
      title: 'September',
      artist: 'Earth, Wind & Fire',
      artists: [{ id: 'artist1aaaaaaaaaaaaaaa', name: 'Earth, Wind & Fire' }],
    });
    expect(spotifyFetch).toHaveBeenCalledWith('/tracks/trackaaaaaaaaaaaaaaaaa', 'app-token');
  });

  it('carries every artist on a multi-artist track, not just the first', async () => {
    spotifyFetch.mockResolvedValue(
      rawTrack('trackbbbbbbbbbbbbbbbbb', 'Blurred Lines', [
        { id: 'artistthickeaaaaaaaaaa', name: 'Robin Thicke' },
        { id: 'artistpharrellaaaaaaaa', name: 'Pharrell Williams' },
      ]),
    );

    const result = await getTrack('trackbbbbbbbbbbbbbbbbb');

    expect(result?.artists).toHaveLength(2);
    expect(result?.artists[1]).toEqual({ id: 'artistpharrellaaaaaaaa', name: 'Pharrell Williams' });
  });

  // G4: `spotify_tracks.artist_len` requires 1-200 chars. `?? ''` would
  // violate it and cause the upsert to fail for ever on a track shaped
  // this way -- the exact starvation the sentinel exists to avoid, via a
  // different path (a CHECK violation rather than a 404).
  it('falls back to a non-empty placeholder artist for a zero-artist track, never an empty string', async () => {
    spotifyFetch.mockResolvedValue(rawTrack('trackddddddddddddddddd', 'Untitled', []));

    const result = await getTrack('trackddddddddddddddddd');

    expect(result?.artist).not.toBe('');
    expect(result?.artist.length).toBeGreaterThan(0);
  });

  it('returns null for a 404 rather than throwing', async () => {
    spotifyFetch.mockRejectedValue(new SpotifyError('unavailable', 404, '/tracks/x'));

    const result = await getTrack('trackccccccccccccccccc');

    expect(result).toBeNull();
  });

  it('rethrows a non-404 error', async () => {
    spotifyFetch.mockRejectedValue(new SpotifyError('rate_limited', 429, '/tracks/x'));

    await expect(getTrack('trackccccccccccccccccc')).rejects.toMatchObject({ status: 429 });
  });
});

describe('resolveTracks', () => {
  it('drops an id that 404s rather than throwing for the whole call', async () => {
    spotifyFetch.mockImplementation(async (path: string) => {
      if (path === '/tracks/trackaaaaaaaaaaaaaaaaa') {
        return rawTrack('trackaaaaaaaaaaaaaaaaa', 'September', [
          { id: 'artist1aaaaaaaaaaaaaaa', name: 'Earth, Wind & Fire' },
        ]);
      }
      throw new SpotifyError('unavailable', 404, path);
    });

    const result = await resolveTracks(['trackaaaaaaaaaaaaaaaaa', 'trackccccccccccccccccc']);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].id).toBe('trackaaaaaaaaaaaaaaaaa');
    expect(result.notFound).toEqual(['trackccccccccccccccccc']);
  });

  it('never attempts more than `max` ids', async () => {
    spotifyFetch.mockImplementation(async (path: string) =>
      rawTrack(path.replace('/tracks/', ''), 'Song', [{ id: 'artist1aaaaaaaaaaaaaaa', name: 'Artist' }]),
    );
    const ids = Array.from({ length: 20 }, (_, i) => `id${i}`.padEnd(22, '0'));

    await resolveTracks(ids, { max: 10, concurrency: 5 });

    expect(spotifyFetch).toHaveBeenCalledTimes(10);
  });

  it('never has more than `concurrency` requests in flight at once', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: (() => void)[] = [];

    spotifyFetch.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          resolvers.push(() => {
            inFlight -= 1;
            resolve(rawTrack(path.replace('/tracks/', ''), 'Song', []));
          });
        }),
    );

    const ids = Array.from({ length: 9 }, (_, i) => `id${i}`.padEnd(22, '0'));
    const promise = resolveTracks(ids, { max: 9, concurrency: 3 });

    // Let the first wave of requests actually start.
    await flush();
    expect(inFlight).toBe(3);

    // Drain in waves, checking the ceiling never rises above 3, until every
    // request has been resolved.
    for (let drained = 0; drained < ids.length; ) {
      const wave = resolvers.splice(0, resolvers.length);
      drained += wave.length;
      for (const resolve of wave) resolve();
      await flush();
    }

    await promise;
    expect(maxInFlight).toBe(3);
  });
});
