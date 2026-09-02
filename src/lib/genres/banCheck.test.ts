import { describe, expect, it, vi } from 'vitest';

import { genreBanVerdict, type BanCheckDeps } from './banCheck';
import type { EnrichInput } from './enrich';

function bcDeps(over: Partial<BanCheckDeps> = {}): BanCheckDeps {
  return {
    readGenres:    vi.fn(async (_e: string, _a: string) => null),
    enrichArtist:  vi.fn(async (_i: EnrichInput) =>
                     ({ status: 'resolved', resolvedVia: 'mbid',
                        genres: { genres: {}, origins: {}, eras: {} } } as const)),
    blockedGenres: vi.fn(async (_e: string) => [] as string[]),
    ...over,
  };
}

describe('genreBanVerdict', () => {
  it('reads the cache and does NOT re-enrich an artist already resolved', async () => {
    const d = bcDeps({
      readGenres:    vi.fn(async (_e: string, _a: string) =>
                       ({ genres: { metal: 90 }, origins: {}, eras: {} })),
      blockedGenres: vi.fn(async (_e: string) => ['metal']),
    });
    const out = await genreBanVerdict('e-1', { id: 'a-1', name: 'X' }, d);
    expect(d.readGenres).toHaveBeenCalledWith('e-1', 'a-1');
    expect(d.enrichArtist).not.toHaveBeenCalled();
    // A POSITIVE outcome derived from the cached row. Asserting only
    // `enrichArtist` was not called would pass against a function that returns
    // a hardcoded verdict without reading anything.
    expect(out).toMatchObject({ banned: true, matchedGenre: 'metal' });
  });

  it('enriches on a cache miss, then answers from the fresh result', async () => {
    const d = bcDeps({
      readGenres: vi.fn(async () => null),
      enrichArtist: vi.fn(async () => ({
        status: 'resolved', resolvedVia: 'mbid',
        genres: { genres: { metal: 90 }, origins: {}, eras: {} },
      } as const)),
      blockedGenres: vi.fn(async () => ['metal']),
    });
    const out = await genreBanVerdict('e-1', { id: 'a-1', name: 'X' }, d);
    expect(d.enrichArtist).toHaveBeenCalled();
    expect(out).toMatchObject({ banned: true, matchedGenre: 'metal' });
  });

  it('matches a blocked genre through the SAME alias table the filter uses', async () => {
    // the couple blocked 'r&b'; the artist's resolved genre key is 'rnb'
    const d = bcDeps({
      readGenres: vi.fn(async () => ({ genres: { rnb: 80 }, origins: {}, eras: {} })),
      blockedGenres: vi.fn(async () => ['r&b']),
    });
    await expect(genreBanVerdict('e-1', { id: 'a-1', name: 'X' }, d))
      .resolves.toMatchObject({ banned: true, matchedGenre: 'rnb' });
  });

  it('does NOT ban on a substring collision -- rap must not match trap', async () => {
    const d = bcDeps({
      readGenres: vi.fn(async () => ({ genres: { trap: 80 }, origins: {}, eras: {} })),
      blockedGenres: vi.fn(async () => ['rap']),
    });
    await expect(genreBanVerdict('e-1', { id: 'a-1', name: 'X' }, d))
      .resolves.toMatchObject({ banned: false });
  });

  it('FAILS OPEN when enrichment errors, and says so in the reason', async () => {
    // a DJ screen that silently drops a song because Last.fm was down is worse
    // than one that plays it: the explicit blocklist is unaffected either way.
    const d = bcDeps({
      readGenres: vi.fn(async () => null),
      enrichArtist: vi.fn(async () => ({ status: 'failed', reason: 'lastfm 503' } as const)),
    });
    const out = await genreBanVerdict('e-1', { id: 'a-1', name: 'X' }, d);
    expect(out.banned).toBe(false);
    expect(out.reason).toMatch(/could not be checked/i);
  });

  it('gives a reason on the NOT-banned path too -- the engine explains itself', async () => {
    const d = bcDeps({ readGenres: vi.fn(async () => ({ genres: { pop: 90 }, origins: {}, eras: {} })) });
    const out = await genreBanVerdict('e-1', { id: 'a-1', name: 'X' }, d);
    expect(out.reason).toBeTruthy();
    expect(out.reason).toContain('pop');
  });

  it('a band called Disco does not ban the disco genre', async () => {
    const d = bcDeps({
      readGenres: vi.fn(async (_e: string, _a: string) =>
        ({ genres: { disco: 80 }, origins: {}, eras: {} })),
      blockedGenres: vi.fn(async (_e: string) => []),  // the 'Disco' ARTIST row is filtered out
    });
    await expect(genreBanVerdict('e-1', { id: 'a-1', name: 'X' }, d))
      .resolves.toMatchObject({ banned: false });
  });
});
