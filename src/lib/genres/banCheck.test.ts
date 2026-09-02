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

  // "A band called Disco does not ban the disco genre" WAS tested here and
  // was a no-op (fix-spec should-fix): the mocked `blockedGenres` returned
  // `[]`, so `matched` was `undefined` unconditionally and `banned: false`
  // held for any input or matching logic -- it could not have failed under
  // any mutation to genreBanVerdict.
  //
  // DELETED rather than rewritten: the behaviour it names -- an artist named
  // "Disco" blocklisted by NAME must not ban the "disco" GENRE -- is not
  // something genreBanVerdict can protect against at all. It has no
  // name-vs-genre distinction of its own; that filtering happens entirely
  // upstream, in genresDal.blockedGenres's `.eq('entry_type', 'genre')`
  // (genresDal.test.ts:224, "resolves the blocked genre values, filtered to
  // entry_type = genre"). Mocking THIS function's `blockedGenres` dep to
  // return `['Disco']` (as the spec's literal suggestion would) does not
  // reproduce that upstream filtering -- normaliseGenre('Disco') lowercases
  // to 'disco', which exactly matches the genre key 'disco', so
  // genreBanVerdict would correctly report `banned: true` against that
  // fixture. Asserting `banned: false` against it would pin a WRONG
  // expectation, not a real one.
});
