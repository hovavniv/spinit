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

/**
 * `enrichment_queue` builder for the reconciliation added by task 7b:
 * `select('artist_id').eq(...)` (the existing-queue read), `insert(...).select()`
 * (new rows), `update(...).eq(...).in(...).select()` (batch settle of stale rows).
 * All three are stubbed here rather than via queueDal's own mocks: sync.ts
 * calls `existingArtistIds`/`insertQueueRows`/`settleMany` from
 * `@/lib/genres/queueDal`, which is real, unmocked code in this test file --
 * it is `queueDal.ts`'s OWN `createClient` that resolves to this same
 * `fromMock`, since `@/lib/supabase/server` is mocked once, module-wide.
 */
const queueSelectEq = vi.fn();
const queueInsertMock = vi.fn();
const queueInsertSelect = vi.fn();
const queueUpdateMock = vi.fn();
const queueUpdateEq1 = vi.fn();
const queueUpdateIn = vi.fn();
const queueSettleSelect = vi.fn();

function enrichmentQueueTable() {
  queueInsertMock.mockReturnValue({ select: queueInsertSelect });
  queueUpdateEq1.mockReturnValue({ in: queueUpdateIn });
  queueUpdateIn.mockReturnValue({ select: queueSettleSelect });
  queueUpdateMock.mockReturnValue({ eq: queueUpdateEq1 });

  return {
    select: vi.fn().mockReturnValue({ eq: queueSelectEq }),
    insert: queueInsertMock,
    update: queueUpdateMock,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  spotifyFetchMock.mockResolvedValue({ items: [] });
  // Stored and refreshed tokens agree, so withUserToken never needs to write
  // a rotation back -- that write belongs to connectionDal.test.ts, not here.
  tokenSingle.mockResolvedValue({ data: { refresh_token: encryptToken('R') }, error: null });
  refreshAccessTokenMock.mockResolvedValue({ accessToken: 'A', refreshToken: 'R' });
  profileUpsertSelect.mockResolvedValue({ data: [{}], error: null });

  queueSelectEq.mockResolvedValue({ data: [], error: null });
  queueInsertSelect.mockResolvedValue({ data: [{ id: 'q1' }], error: null });
  queueSettleSelect.mockResolvedValue({ data: [{ id: 'q1' }], error: null });

  fromMock.mockImplementation((table: string) => {
    if (table === 'spotify_tokens') return tokensTable();
    if (table === 'taste_profiles') return tasteProfilesTable();
    if (table === 'enrichment_queue') return enrichmentQueueTable();
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

/**
 * `spotifyFetchMock` answers every range call identically, so `mergeRanges`
 * merges the same list three times -- an artist's contribution is then
 * strictly decreasing by input rank across all three ranges (short_term's
 * weight of 1.0 always dominates), so the merged, score-sorted order equals
 * this input order. That is what lets these tests assert on fixed ids/
 * positions without re-deriving mergeRanges' own scoring.
 */
function freshArtists(ids: string[]) {
  spotifyFetchMock.mockResolvedValue({
    items: ids.map((id) => ({ id, name: id, images: [] })),
  });
}

/**
 * TASK 7b. `sync.ts` used to guarantee it NEVER touched `enrichment_queue`
 * (C1's boundary, when nothing drained the queue). C2 added
 * `claim_next_artist` (task 2d) and the enrich-next route (task 7), both of
 * which read that queue -- so the old guard now pins the exact bug this task
 * exists to fix (an empty queue forever) rather than a real invariant.
 * Deliberately inverted here, replacing the old
 * "does not seed enrichment_queue — that is C2" test.
 */
it('DOES seed enrichment_queue — reconciliation is C2 task 7b, not deferred anymore',
  async () => {
    freshArtists(['a1']);
    await syncTasteProfile('p1');
    expect(fromMock).toHaveBeenCalledWith('enrichment_queue');
  });

it('inserts a new queue row for a fresh-list artist not already queued', async () => {
  queueSelectEq.mockResolvedValue({ data: [], error: null }); // empty existing queue
  freshArtists(['a1']);
  await syncTasteProfile('p1');
  expect(queueInsertMock).toHaveBeenCalledWith([
    { partner_id: 'p1', artist_id: 'a1', position: 0 },
  ]);
});

it('does NOT insert a row for an artist already present in the queue, ' +
   'settled or not (rule #1\'s positive control)', async () => {
  queueSelectEq.mockResolvedValue({ data: [{ artist_id: 'a1' }], error: null });
  freshArtists(['a1']);
  await syncTasteProfile('p1');
  expect(queueInsertMock).not.toHaveBeenCalled();
});

it("a new row's position matches its index in the score-ordered merged list", async () => {
  queueSelectEq.mockResolvedValue({ data: [], error: null });
  freshArtists(['a1', 'a2', 'a3']);
  await syncTasteProfile('p1');
  expect(queueInsertMock).toHaveBeenCalledWith([
    { partner_id: 'p1', artist_id: 'a1', position: 0 },
    { partner_id: 'p1', artist_id: 'a2', position: 1 },
    { partner_id: 'p1', artist_id: 'a3', position: 2 },
  ]);
});

it("an existing row's position is unchanged on re-sync, even if its rank shifted", async () => {
  // a2 was queued at position 5 (some earlier sync); the fresh list now
  // ranks it first. Only a1 (new) gets inserted -- a2's row is never touched,
  // so its stored position cannot have changed.
  queueSelectEq.mockResolvedValue({ data: [{ artist_id: 'a2' }], error: null });
  freshArtists(['a2', 'a1']);
  await syncTasteProfile('p1');
  expect(queueInsertMock).toHaveBeenCalledWith([
    { partner_id: 'p1', artist_id: 'a1', position: 1 },
  ]);
});

it('surfaces a zero-row insert as an error rather than reporting success', async () => {
  queueSelectEq.mockResolvedValue({ data: [], error: null });
  queueInsertSelect.mockResolvedValue({ data: [], error: null });
  freshArtists(['a1']);
  await expect(syncTasteProfile('p1')).rejects.toThrow(/enrichment_queue insert wrote no rows/);
});

it('settles queue rows for artists that dropped off the new top-artist list', async () => {
  // p1 previously had artists a1, a2, a3 queued. The fresh sync returns only a1, a3.
  queueSelectEq.mockResolvedValue({
    data: [{ artist_id: 'a1' }, { artist_id: 'a2' }, { artist_id: 'a3' }],
    error: null,
  });
  freshArtists(['a1', 'a3']);
  await syncTasteProfile('p1');
  expect(queueUpdateIn).toHaveBeenCalledWith('artist_id', ['a2']);
});

it('settles nothing when the list is unchanged', async () => {
  queueSelectEq.mockResolvedValue({ data: [{ artist_id: 'a1' }], error: null });
  freshArtists(['a1']);
  await syncTasteProfile('p1');
  expect(queueUpdateMock).not.toHaveBeenCalled();
});

it('leaves an UNSETTLED row for an artist still on the list alone', async () => {
  // the positive control: settling everything unsettled would also make the
  // previous test pass, and would silently skip enrichment for a1.
  queueSelectEq.mockResolvedValue({
    data: [{ artist_id: 'a1' }, { artist_id: 'a2' }],
    error: null,
  });
  freshArtists(['a1']);
  await syncTasteProfile('p1');
  expect(queueUpdateIn).toHaveBeenCalledWith('artist_id', ['a2']);
  expect(queueUpdateIn).not.toHaveBeenCalledWith('artist_id', expect.arrayContaining(['a1']));
});

it('surfaces a zero-row settle rather than reporting success', async () => {
  queueSelectEq.mockResolvedValue({
    data: [{ artist_id: 'a1' }, { artist_id: 'a2' }],
    error: null,
  });
  freshArtists(['a1']);
  queueSettleSelect.mockResolvedValue({ data: [], error: null });
  await expect(syncTasteProfile('p1')).rejects.toThrow(/enrichment_queue settle-many wrote no rows/);
});

it('throws when the taste_profiles upsert errors', async () => {
  profileUpsertSelect.mockResolvedValue({ data: null, error: { code: '42501' } });
  await expect(syncTasteProfile('p1')).rejects.toThrow(/taste_profiles upsert failed/);
});

it('throws when the taste_profiles upsert admits zero rows', async () => {
  profileUpsertSelect.mockResolvedValue({ data: [], error: null });
  await expect(syncTasteProfile('p1')).rejects.toThrow(/taste_profiles upsert wrote no row/);
});

/**
 * FIX-SPEC BLOCKER 2. design §2.11: "the top 20 by artistScore" -- the queue
 * must never track the whole merged list (up to ~150 artists), or the
 * enrichment ladder's 2s-per-artist MusicBrainz pacing turns one sync into
 * 5+ minutes and 300+ outbound calls for a report that renders four genre
 * bars.
 */
it('queues at most 20 artists even when the profile has 150', async () => {
  queueSelectEq.mockResolvedValue({ data: [], error: null });
  freshArtists(Array.from({ length: 150 }, (_, i) => `a${i}`));
  await syncTasteProfile('p1');
  expect(queueInsertMock.mock.calls[0][0]).toHaveLength(20);
});

/**
 * DEVIATION FROM THE SPEC'S PASTED FIXTURE: the spec's literal test mocks
 * `existingArtistIds` to `new Set(['a0'])` against a 150-artist fresh list
 * and asserts `settleMany` is called with `[]`. That assertion holds
 * identically whether the stale diff is computed against the CAPPED top-20
 * set or the full uncapped 150 -- 'a0' (rank 0) is inside both, so it is
 * never stale either way, and the test cannot distinguish the two
 * implementations. Rebuilt here so it actually depends on the cap: 'a0' is
 * inside the top 20 and stays fresh either way, but 'a50' was queued by an
 * earlier sync (rank 50, now outside QUEUE_DEPTH) -- comparing against the
 * capped set correctly settles it as stale; comparing against the uncapped
 * list (a50 is still present in the full merged list, just past the cap)
 * would never settle it.
 */
it('settles a previously-queued artist that fell outside the top-20 window, ' +
   'not one still inside it', async () => {
  queueSelectEq.mockResolvedValue({
    data: [{ artist_id: 'a0' }, { artist_id: 'a50' }],
    error: null,
  });
  freshArtists(Array.from({ length: 150 }, (_, i) => `a${i}`));
  await syncTasteProfile('p1');
  expect(queueUpdateIn).toHaveBeenCalledWith('artist_id', ['a50']);
});
