import { it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

process.env.SPOTIFY_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

import { from, spotifyFetch, profileUpsert, refreshAccessToken } from './__tests__/harness';

/**
 * The harness's mocked functions are each typed from their own zero/loose
 * arrow-function implementation, not from the real modules they stand in
 * for -- so a wrapper that forwards `...args` (or indexing `.mock.calls[0][0]`)
 * fails `tsc`, not at runtime (see CLAUDE.md's `vi.fn` gotcha). These aliases
 * carry the REAL call signatures while sharing the same underlying `vi.fn`
 * instance as the harness export.
 */
const spotifyFetchMock = spotifyFetch as unknown as
  Mock<(endpoint: string, token: string, init?: RequestInit) => Promise<{ items: unknown[] }>>;
const refreshAccessTokenMock = refreshAccessToken as unknown as
  Mock<(token: string) => Promise<{ accessToken: string; refreshToken: string }>>;
const profileUpsertMock = profileUpsert as unknown as
  Mock<(payload: { top_artists: unknown[] }, opts: { onConflict: string }) =>
    { select: () => Promise<{ data: unknown[] | null; error: { code: string } | null }> }>;
const fromMock = from as unknown as Mock<(table: string) => unknown>;

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: fromMock }) }));
vi.mock('./client', () => ({
  spotifyFetch: (endpoint: string, token: string, init?: RequestInit) =>
    spotifyFetchMock(endpoint, token, init),
}));
vi.mock('./oauth', () => ({
  refreshAccessToken: (token: string) => refreshAccessTokenMock(token),
}));

import { encryptToken } from './crypto';
import { syncTasteProfile } from './sync';

const tokenSingle = vi.fn();
const profileUpsertSelect = vi.fn();

/** `spotify_tokens` builder for `withUserToken` (real, unmocked, run by sync.ts). */
function tokensTable() {
  const eq = vi.fn().mockReturnValue({ single: tokenSingle });
  return { select: vi.fn().mockReturnValue({ eq }) };
}

/** `taste_profiles` builder: upsert() chains into .select(), same convention
 *  as every other write in connectionDal.ts. */
function tasteProfilesTable() {
  profileUpsertMock.mockReturnValue({ select: profileUpsertSelect });
  return { upsert: profileUpsertMock };
}

beforeEach(() => {
  vi.clearAllMocks();
  spotifyFetchMock.mockResolvedValue({ items: [] });
  // Stored and refreshed tokens agree, so withUserToken never needs to write
  // a rotation back -- that write belongs to connectionDal.test.ts, not here.
  tokenSingle.mockResolvedValue({ data: { refresh_token: encryptToken('R') }, error: null });
  refreshAccessTokenMock.mockResolvedValue({ accessToken: 'A', refreshToken: 'R' });
  profileUpsertSelect.mockResolvedValue({ data: [{}], error: null });
  fromMock.mockImplementation((table: string) => {
    if (table === 'spotify_tokens') return tokensTable();
    if (table === 'taste_profiles') return tasteProfilesTable();
    throw new Error(`unexpected table ${table}`);
  });
});

it('queries all THREE time ranges', async () => {
  await syncTasteProfile('p1');
  const ranges = spotifyFetchMock.mock.calls.map((c) => new URL('http://x' + c[0])
    .searchParams.get('time_range'));
  expect(ranges.sort()).toEqual(['long_term', 'medium_term', 'short_term']);
});

it('asks for limit=50 on every range', async () => {
  await syncTasteProfile('p1');
  for (const call of spotifyFetchMock.mock.calls) {
    expect(call[0]).toContain('limit=50');
  }
});

it('stores every merged artist, not only the top 20', async () => {
  spotifyFetchMock.mockResolvedValue({ items: Array.from({ length: 50 }, (_, i) => ({
    id: `id${i}`.padEnd(22, 'x'), name: `A${i}`, images: [] })) });
  await syncTasteProfile('p1');
  const written = profileUpsertMock.mock.calls[0][0];
  expect(written.top_artists.length).toBeGreaterThan(20);
});

it('does NOT write events.couple_status — that write is a silent no-op under a\n' +
   "partner's session and is deferred to C2", async () => {
  await syncTasteProfile('p1');
  expect(fromMock).not.toHaveBeenCalledWith('events');
});

it('stores an EMPTY profile rather than throwing when all three ranges are empty',
  async () => {
    spotifyFetchMock.mockResolvedValue({ items: [] });
    await expect(syncTasteProfile('p1')).resolves.not.toThrow();
    const written = profileUpsertMock.mock.calls[0][0];
    expect(written.top_artists).toEqual([]);
  });

it('writes top_artists in SNAKE case, whatever the TypeScript surface says', async () => {
  await syncTasteProfile('p1');
  expect(profileUpsertMock.mock.calls[0][0]).toHaveProperty('top_artists');
  expect(profileUpsertMock.mock.calls[0][0]).not.toHaveProperty('topArtists');
});

it('UPSERTS the profile, so a re-sync does not fail on an existing row', async () => {
  await syncTasteProfile('p1');
  expect(profileUpsertMock).toHaveBeenCalledWith(expect.anything(),
                                             { onConflict: 'partner_id' });
});

it('does not seed enrichment_queue — that is C2', async () => {
  await syncTasteProfile('p1');
  expect(fromMock).not.toHaveBeenCalledWith('enrichment_queue');
});
