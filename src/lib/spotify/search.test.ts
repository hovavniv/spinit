import { describe, expect, it, vi, beforeEach } from 'vitest';
import { spotifyFetch } from './client';
import { searchArtists, searchTracks } from './search';

vi.mock('./appToken', () => ({
  appToken: vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => 'test-token'),
}));

vi.mock('./client', () => ({
  spotifyFetch: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(spotifyFetch).mockReset();
});

const TWO_ARTISTS = {
  tracks: { items: [{
    id: '4u7EnebtmKWzUH433cf5Qv', name: 'Barbie Girl', duration_ms: 194000,
    explicit: false,
    artists: [
      { id: '3iAeMv0PGqU2QNvBGDoNaR', name: 'Aqua' },
      { id: '1dfeR4HaWDbWqFHLkxsg1d', name: 'Queen' },
    ],
    album: { name: 'Aquarium', images: [
      { url: 'big.jpg', width: 640 }, { url: 'small.jpg', width: 64 },
    ] },
  }] },
};

describe('searchTracks', () => {
  it('asks for limit=10 even though six are rendered', async () => {
    vi.mocked(spotifyFetch).mockResolvedValue({ tracks: { items: [] } });
    await searchTracks('abba');
    expect(vi.mocked(spotifyFetch).mock.calls[0][0]).toContain('limit=10');
  });

  it('keeps EVERY artist id, not just the first', async () => {
    vi.mocked(spotifyFetch).mockResolvedValue(TWO_ARTISTS);
    const [t] = await searchTracks('barbie');
    expect(t.artistIds).toEqual(['3iAeMv0PGqU2QNvBGDoNaR', '1dfeR4HaWDbWqFHLkxsg1d']);
    expect(t.artistNames).toEqual(['Aqua', 'Queen']);
  });

  it('picks the smallest artwork at least 64px', async () => {
    vi.mocked(spotifyFetch).mockResolvedValue(TWO_ARTISTS);
    const [t] = await searchTracks('barbie');
    expect(t.artworkUrl).toBe('small.jpg');
  });

  it('returns null artwork when the album has no images', async () => {
    vi.mocked(spotifyFetch).mockResolvedValue({
      tracks: { items: [{
        ...TWO_ARTISTS.tracks.items[0],
        album: { name: 'x', images: [] },
      }] },
    });
    const [t] = await searchTracks('barbie');
    expect(t.artworkUrl).toBeNull();
  });

  it('returns [] rather than throwing when there is no tracks key', async () => {
    vi.mocked(spotifyFetch).mockResolvedValue({});
    await expect(searchTracks('x')).resolves.toEqual([]);
  });

  it('does not leak Spotify fields we did not ask for', async () => {
    vi.mocked(spotifyFetch).mockResolvedValue(TWO_ARTISTS);
    const result = await searchTracks('barbie');
    expect(Object.keys(result[0]).sort()).toEqual(
      ['albumName', 'artistIds', 'artistNames', 'artworkUrl', 'durationMs', 'explicit', 'id', 'name'],
    );
  });
});

describe('searchArtists', () => {
  it('returns the trimmed SpotifyArtist shape', async () => {
    vi.mocked(spotifyFetch).mockResolvedValue({
      artists: { items: [{ id: 'abc', name: 'Aqua', images: [{ url: 'art.jpg', width: 300 }] }] },
    });
    const result = await searchArtists('aqua');
    expect(result).toEqual([{ id: 'abc', name: 'Aqua', artworkUrl: 'art.jpg' }]);
  });

  it('returns [] rather than throwing when there is no artists key', async () => {
    vi.mocked(spotifyFetch).mockResolvedValue({});
    await expect(searchArtists('x')).resolves.toEqual([]);
  });
});
