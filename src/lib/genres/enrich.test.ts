import { describe, it, expect, vi } from 'vitest';
import { enrichArtist, type EnrichDeps, type ArtistGenresRow } from './enrich';
import { GenreError } from './errors';

const IN = { eventId: 'e-1', artistId: 'a-1', name: 'Omer Adam' };

function deps(over: Partial<EnrichDeps> = {}): EnrichDeps {
  return {
    mbidForSpotifyArtist: vi.fn(async (_id: string) => 'mbid-1'),
    englishAliasFor: vi.fn(async (_mbid: string) => 'Omer Adam'),
    topTagsByMbid: vi.fn(async (_mbid: string) => [{ name: 'mizrahi', count: 100 }]),
    topTagsByName: vi.fn(async (_name: string) => [{ name: 'pop', count: 80 }]),
    writeGenres: vi.fn(async (_row: unknown) => ({ rowCount: 1 })),
    ...over,
  };
}

describe('enrichArtist', () => {
  it('rung 1: mbid then tags-by-mbid resolves, and never reaches a later rung', async () => {
    const d = deps();
    const out = await enrichArtist(IN, d);
    expect(out).toMatchObject({ status: 'resolved', resolvedVia: 'mbid' });
    expect(d.writeGenres).toHaveBeenCalledWith(
      expect.objectContaining({
        artist_name: 'Omer Adam',
        genres: { mizrahi: 100 },
        origins: {},
        eras: {},
        resolved_via: 'mbid',
      }),
    );
    expect(d.englishAliasFor).not.toHaveBeenCalled();
    expect(d.topTagsByName).not.toHaveBeenCalled();
  });

  it('always supplies artist_name -- the column is NOT NULL with no default', async () => {
    const d = deps();
    await enrichArtist(IN, d);
    const row = (d.writeGenres as ReturnType<typeof vi.fn>).mock.calls[0][0] as ArtistGenresRow;
    expect(row.artist_name).toBe('Omer Adam');
  });

  it('caches the MBID even when the tag lookup finds nothing', async () => {
    // 2.10: the MBID is stable and cached independently of the tags, so a
    // Last.fm miss does not force re-resolving the alias on the next attempt.
    const d = deps({
      topTagsByMbid: vi.fn(async (_m: string) => []),
      topTagsByName: vi.fn(async (_n: string) => []),
    });
    await enrichArtist(IN, d);
    const row = (d.writeGenres as ReturnType<typeof vi.fn>).mock.calls[0][0] as ArtistGenresRow;
    expect(row.musicbrainz_id).toBe('mbid-1');
  });

  it('no MBID skips the alias rung entirely and goes to the Spotify-name rung', async () => {
    // the alias rung queries /ws/2/artist/<mbid> -- without an mbid it cannot run at all
    const d = deps({ mbidForSpotifyArtist: vi.fn(async (_id: string) => null) });
    const out = await enrichArtist(IN, d);
    expect(d.englishAliasFor).not.toHaveBeenCalled();
    expect(d.topTagsByName).toHaveBeenCalledWith('Omer Adam');
    expect(out).toMatchObject({ status: 'resolved', resolvedVia: 'spotify_name' });
  });

  it('empty tags by mbid falls through to the alias rung, keeping the mbid', async () => {
    const d = deps({ topTagsByMbid: vi.fn(async (_m: string) => []) });
    const out = await enrichArtist(IN, d);
    expect(d.englishAliasFor).toHaveBeenCalledWith('mbid-1');
    expect(d.topTagsByName).toHaveBeenCalledWith('Omer Adam');
    expect(out).toMatchObject({ status: 'resolved', resolvedVia: 'alias' });
  });

  it('empty at every rung stores RESOLVED with {} and resolvedVia none', async () => {
    const d = deps({
      topTagsByMbid: vi.fn(async (_m: string) => []),
      topTagsByName: vi.fn(async (_n: string) => []),
    });
    const out = await enrichArtist(IN, d);
    expect(out).toEqual({
      status: 'resolved',
      resolvedVia: 'none',
      genres: { genres: {}, origins: {}, eras: {} },
    });
    expect(d.writeGenres).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'resolved', resolved_via: 'none' }),
    );
  });

  it('an ERROR at any rung abandons the ladder and stores FAILED, never resolved', async () => {
    const d = deps({
      topTagsByMbid: vi.fn(async (_m: string) => {
        throw new GenreError('unavailable', 'lastfm 503');
      }),
    });
    const out = await enrichArtist(IN, d);
    expect(out).toMatchObject({ status: 'failed' });
    expect(d.topTagsByName).not.toHaveBeenCalled();
    const written = (d.writeGenres as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(written.status).toBe('failed');
    expect(written.genres).toBeUndefined();
  });

  it('a 429 is an ERROR, not an empty -- the classifier is default-deny', async () => {
    const d = deps({
      topTagsByMbid: vi.fn(async (_m: string) => {
        throw new GenreError('rate_limited', 'lastfm 429');
      }),
    });
    await expect(enrichArtist(IN, d)).resolves.toMatchObject({ status: 'failed' });
    expect(d.topTagsByName).not.toHaveBeenCalled();
  });

  it('an unrecognised throw is an ERROR too -- not silently an empty', async () => {
    const d = deps({
      topTagsByMbid: vi.fn(async (_m: string) => {
        throw new TypeError('bad json');
      }),
    });
    await expect(enrichArtist(IN, d)).resolves.toMatchObject({ status: 'failed' });
  });

  it("Last.fm's not-found IS an empty, and falls through rather than failing", async () => {
    // topTagsByMbid already maps error 6 to [] (task 4) -- this pins that enrich
    // treats that [] as a fall-through and not as a failure
    const d = deps({ topTagsByMbid: vi.fn(async (_m: string) => []) });
    await expect(enrichArtist(IN, d)).resolves.toMatchObject({ status: 'resolved' });
  });

  it('a failed WRITE surfaces as failed rather than reporting success', async () => {
    const d = deps({ writeGenres: vi.fn(async (_r: unknown) => ({ rowCount: 0 })) });
    await expect(enrichArtist(IN, d)).resolves.toMatchObject({ status: 'failed' });
  });
});
