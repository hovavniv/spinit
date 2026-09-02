import { it, expect, vi, beforeEach } from 'vitest';
import type { EnrichOutcome } from '@/lib/genres/enrich';

// Every collaborator the route has, mocked at the module boundary. Declared with
// vi.hoisted so the vi.mock factories below can close over them.
const {
  rpc, from, requireUser, partnerContext, settle, releaseClaim, queueCounts, enrichArtist,
  writeGenreWeights,
  tpSelect, tpEq, tpSingle, agSelect, agEq,
} = vi.hoisted(() => ({
  rpc:               vi.fn(async (_fn: string, _args: unknown) =>
                       ({ data: [{ artist_id: 'a-1', event_id: 'e-1' }], error: null })),
  from:              vi.fn(),
  requireUser:       vi.fn(async () => ({ id: 'u-partner-1' })),
  // Return type widened explicitly to `string | null` -- otherwise TS infers the
  // narrower literal 'u-partner-1' from this initial implementation, and a later
  // `mockResolvedValue({ userId: null, ... })` fails to typecheck (TS2322).
  partnerContext:    vi.fn(async (_partnerId: string): Promise<{ userId: string | null; eventId: string } | null> =>
                       ({ userId: 'u-partner-1', eventId: 'e-1' })),
  settle:            vi.fn(async (_p: string, _a: string) => ({ rowCount: 1 })),
  releaseClaim:      vi.fn(async (_p: string, _a: string) => ({ rowCount: 1 })),
  queueCounts:       vi.fn(async (_p: string) => ({ total: 30, settled: 12 })),
  // Return type widened explicitly to `EnrichOutcome` -- otherwise TS infers the
  // narrower literal shape from this initial implementation ({ status: 'resolved',
  // resolvedVia: 'mbid' }), and a later `mockResolvedValue({ status: 'failed', ... })`
  // or `resolvedVia: 'none'` fails to typecheck (TS2322).
  enrichArtist:      vi.fn(async (_i: unknown, _d: unknown): Promise<EnrichOutcome> =>
                       ({ status: 'resolved', resolvedVia: 'mbid', genres: { genres: {}, origins: {}, eras: {} } })),
  writeGenreWeights: vi.fn(async (_p: string, _w: unknown) => ({ rowCount: 1 })),
  // taste_profiles: .select('top_artists').eq('partner_id', p).single()
  tpSelect: vi.fn(),
  tpEq: vi.fn(),
  tpSingle: vi.fn(),
  // artist_genres: .select('spotify_artist_id, genres, origins, eras').eq('event_id', e)
  agSelect: vi.fn(),
  agEq: vi.fn(),
}));

// dal.ts, not requireUser.ts -- there is no @/lib/auth/requireUser module. requireUser is
// wrapped in React `cache` at dal.ts:35.
vi.mock('@/lib/auth/dal', () => ({ requireUser }));
// The route's own supabase client is used for TWO things beyond the DAL calls: the
// claim_next_artist rpc, and reading this partner's own taste_profiles.top_artists /
// this event's artist_genres rows directly -- there is no existing DAL read for "every
// artist_genres row in one event" or "one partner's own top_artists", and the recompute
// step (task 7's own text) explicitly allows querying "directly via the injected Supabase
// client" rather than inventing a new DAL function for a one-off read.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc, from })) }));
// A factory mock replaces the WHOLE module, blanking storeConnection, markConnectionFailed,
// disconnect and withUserToken alongside partnerOwner. Spread the real module so only
// partnerContext is added.
vi.mock('@/lib/spotify/connectionDal', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  partnerContext,
}));
vi.mock('@/lib/genres/queueDal', () => ({ settle, releaseClaim, queueCounts }));
vi.mock('@/lib/genres/genresDal', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  writeGenreWeights,
}));
vi.mock('@/lib/genres/enrich', () => ({ enrichArtist }));

import { POST } from './route';

function tasteProfilesTable() {
  tpEq.mockReturnValue({ single: tpSingle });
  tpSelect.mockReturnValue({ eq: tpEq });
  return { select: tpSelect };
}

function artistGenresTable() {
  agEq.mockReturnValue(Promise.resolve({ data: [], error: null }));
  agSelect.mockReturnValue({ eq: agEq });
  return { select: agSelect };
}

// Every test starts from the same known state rather than inheriting the last
// test's overrides -- fixtures reset, they do not assume.
beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: 'u-partner-1' });
  partnerContext.mockResolvedValue({ userId: 'u-partner-1', eventId: 'e-1' });
  rpc.mockResolvedValue({ data: [{ artist_id: 'a-1', event_id: 'e-1' }], error: null });
  settle.mockResolvedValue({ rowCount: 1 });
  releaseClaim.mockResolvedValue({ rowCount: 1 });
  queueCounts.mockResolvedValue({ total: 30, settled: 12 });
  enrichArtist.mockResolvedValue({ status: 'resolved', resolvedVia: 'mbid', genres: { genres: {}, origins: {}, eras: {} } });
  writeGenreWeights.mockResolvedValue({ rowCount: 1 });

  tpSingle.mockResolvedValue({
    data: { top_artists: [{ id: 'a-1', name: 'The Testers', artworkUrl: null, score: 1, ranges: ['short_term'] }] },
    error: null,
  });
  agEq.mockReturnValue(Promise.resolve({ data: [], error: null }));

  from.mockImplementation((table: string) => {
    if (table === 'taste_profiles') return tasteProfilesTable();
    if (table === 'artist_genres') return artistGenresTable();
    throw new Error(`unexpected table ${table}`);
  });
});

function post(body: unknown) {
  return new Request('http://localhost/api/spotify/enrich-next', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

// Authorization is IDENTITY, not "not the DJ" -- taste_profiles' write policy is
// `p.user_id = auth.uid()`. Nothing stops a partner who also DJs their own event; refusing
// them would lock out a legitimate owner for no reason event_partners enforces.
it('refuses the event DJ, who owns no partner row -- their write would be zero rows', async () => {
  partnerContext.mockResolvedValue({ userId: 'u-partner-1', eventId: 'e-1' });
  requireUser.mockResolvedValue({ id: 'u-dj' });
  expect((await POST(post({ partnerId: 'p-1' }))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

it('ALLOWS a user who owns the partner row even if they also DJ the event', async () => {
  partnerContext.mockResolvedValue({ userId: 'u-both', eventId: 'e-1' });
  requireUser.mockResolvedValue({ id: 'u-both' });
  expect((await POST(post({ partnerId: 'p-1' }))).status).toBe(200);
});

it('refuses a partner of a DIFFERENT event -- identity, not participation', async () => {
  partnerContext.mockResolvedValue({ userId: 'u-other-couple', eventId: 'e-2' });
  requireUser.mockResolvedValue({ id: 'u-partner-1' });
  expect((await POST(post({ partnerId: 'p-other' }))).status).toBe(403);
});

it('refuses an unclaimed partner slot -- user_id is nullable', async () => {
  partnerContext.mockResolvedValue({ userId: null, eventId: 'e-1' });
  requireUser.mockResolvedValue({ id: 'u-partner-1' });
  expect((await POST(post({ partnerId: 'p-1' }))).status).toBe(403);
});

it('rejects a body with no partnerId, without calling the rpc', async () => {
  const res = await POST(post({}));
  expect(res.status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it('claims through the rpc, never through a raw update', async () => {
  rpc.mockResolvedValue({ data: [{ artist_id: 'a-1', event_id: 'e-1' }], error: null });
  await POST(post({ partnerId: 'p-1' }));
  expect(rpc).toHaveBeenCalledWith('claim_next_artist', { p_partner: 'p-1' });
});

it('settles the queue row on a resolved outcome', async () => {
  enrichArtist.mockResolvedValue({ status: 'resolved', resolvedVia: 'mbid', genres: { genres: {}, origins: {}, eras: {} } });
  await POST(post({ partnerId: 'p-1' }));
  expect(settle).toHaveBeenCalledWith('p-1', 'a-1');
});

it('does NOT settle on a transport failure -- failed is NOT terminal (§2.10)', async () => {
  enrichArtist.mockResolvedValue({ status: 'failed', reason: 'lastfm 503' });
  await POST(post({ partnerId: 'p-1' }));
  expect(settle).not.toHaveBeenCalled();
  expect(releaseClaim).toHaveBeenCalledWith('p-1', 'a-1');
});

it('settles ONLY on a resolved outcome, including resolvedVia none', async () => {
  // 'none' means the ladder ran to the end and found nothing usable. That is a
  // real answer and it is terminal -- unlike a 503, which is not an answer.
  enrichArtist.mockResolvedValue({ status: 'resolved', resolvedVia: 'none', genres: { genres: {}, origins: {}, eras: {} } });
  await POST(post({ partnerId: 'p-1' }));
  expect(settle).toHaveBeenCalledWith('p-1', 'a-1');
});

it('does NOT settle when enrichArtist itself throws -- it releases the claim', async () => {
  enrichArtist.mockRejectedValue(new Error('socket hang up'));
  const res = await POST(post({ partnerId: 'p-1' }));
  expect(settle).not.toHaveBeenCalled();
  expect(releaseClaim).toHaveBeenCalledWith('p-1', 'a-1');
  expect(res.status).toBe(503);
});

it('counts remaining/settled/total over the QUEUE, not over top_artists', async () => {
  // total is count(*) from enrichment_queue for this partner -- design 2.10.
  // top_artists can hold 50 while the queue holds 30; using the wrong one
  // makes the progress bar wrong and never reach 100%.
  queueCounts.mockResolvedValue({ total: 30, settled: 12 });
  const res = await POST(post({ partnerId: 'p-1' }));
  await expect(res.json()).resolves.toMatchObject({ total: 30, settled: 12, remaining: 18 });
});

it('returns done when the queue is drained, without erroring', async () => {
  rpc.mockResolvedValue({ data: [], error: null });
  queueCounts.mockResolvedValue({ total: 30, settled: 30 });
  const res = await POST(post({ partnerId: 'p-1' }));
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({ remaining: 0 });
  expect(enrichArtist).not.toHaveBeenCalled();
});

// Added beyond the plan's pasted test: the 2d migration's backoff clause means a claim can
// legitimately come back empty while the queue still has unsettled work (every remaining row
// cooling off after a transport failure) -- that is NOT the same as "drained", and the client
// needs a signal to keep polling rather than treat this response as done.
it(
  'signals backing off, not drained, when the claim returns no row while settled < total',
  async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    queueCounts.mockResolvedValue({ total: 30, settled: 12 });
    const res = await POST(post({ partnerId: 'p-1' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { remaining: number; settled: number; total: number; retryAfter?: number };
    expect(body).toMatchObject({ total: 30, settled: 12, remaining: 18 });
    expect(typeof body.retryAfter).toBe('number');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(enrichArtist).not.toHaveBeenCalled();
  },
);

it('releases the claim rather than inserting a null name when the id is not in top_artists', async () => {
  // artist_name is NOT NULL; a claimed id with no matching profile entry must
  // not become a 23502 mid-request. The name comes from the partner's own
  // taste_profiles.top_artists -- the only place it exists (ScoredArtist,
  // src/lib/spotify/tasteTypes.ts).
  rpc.mockResolvedValue({ data: [{ artist_id: 'a-unknown', event_id: 'e-1' }], error: null });
  const res = await POST(post({ partnerId: 'p-1' }));
  expect(enrichArtist).not.toHaveBeenCalled();
  expect(releaseClaim).toHaveBeenCalledWith('p-1', 'a-unknown');
  expect(res.status).toBe(200);
});

it('writes the recomputed genre weights', async () => {
  await POST(post({ partnerId: 'p-1' }));
  expect(writeGenreWeights).toHaveBeenCalledWith('p-1', expect.anything());
});

it('503s when the genre-weights write landed ZERO rows', async () => {
  writeGenreWeights.mockResolvedValue({ rowCount: 0 });
  expect((await POST(post({ partnerId: 'p-1' }))).status).toBe(503);
});

it('503s when settle landed zero rows', async () => {
  settle.mockResolvedValue({ rowCount: 0 });
  expect((await POST(post({ partnerId: 'p-1' }))).status).toBe(503);
});
