import { beforeEach, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import {
  from, cookieSet, cookieDelete, cookieGet,
  storeConnection, markConnectionFailed, partnerOwner,
  refreshAccessToken, exchangeCode, spotifyFetch, syncTasteProfile,
  requireUser,
  req,
} from '@/lib/spotify/__tests__/harness';

/**
 * The harness's mocked functions are each typed from their own zero/loose
 * arrow-function implementation (e.g. `vi.fn(async () => ({...}))`), not
 * from the real modules they stand in for -- so a wrapper that forwards
 * `...args` (or an assertion that indexes `.mock.calls[0][0]`) fails `tsc`,
 * not at runtime (see CLAUDE.md's `vi.fn` gotcha). These aliases carry the
 * REAL call signatures so every mock factory and assertion below typechecks,
 * while still sharing the same underlying `vi.fn` instance (and its
 * `.mock.calls`) as the harness export.
 */
const exchangeCodeMock = exchangeCode as unknown as
  Mock<(code: string) => Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>>;
const refreshAccessTokenMock = refreshAccessToken as unknown as
  Mock<(token: string) => Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>>;
const storeConnectionMock = storeConnection as unknown as
  Mock<(input: { partnerId: string; spotifyUserId: string; refreshToken: string }) => Promise<void>>;
const markConnectionFailedMock = markConnectionFailed as unknown as
  Mock<(partnerId: string, reason: string) => Promise<void>>;
const spotifyFetchMock = spotifyFetch as unknown as
  Mock<(endpoint: string, token: string, init?: RequestInit) => Promise<{ id: string }>>;
const syncTasteProfileMock = syncTasteProfile as unknown as Mock<(partnerId: string) => Promise<void>>;
const requireUserMock = requireUser as unknown as Mock<() => Promise<{ id: string }>>;
const partnerOwnerMock = partnerOwner as unknown as Mock<(partnerId: string) => Promise<string | null>>;

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieGet(name),
    set: (name: string, value: string, opts: unknown) => cookieSet(name, value, opts),
    delete: (name: string) => cookieDelete(name),
  }),
}));

vi.mock('@/lib/spotify/oauth', () => ({
  exchangeCode: (code: string) => exchangeCodeMock(code),
  refreshAccessToken: (token: string) => refreshAccessTokenMock(token),
}));

vi.mock('@/lib/spotify/connectionDal', () => ({
  storeConnection: (input: { partnerId: string; spotifyUserId: string; refreshToken: string }) =>
    storeConnectionMock(input),
  markConnectionFailed: (partnerId: string, reason: string) =>
    markConnectionFailedMock(partnerId, reason),
  partnerOwner: (partnerId: string) => partnerOwnerMock(partnerId),
}));

vi.mock('@/lib/auth/dal', () => ({
  requireUser: () => requireUserMock(),
}));

// Keep the real SpotifyError class -- the route does `instanceof SpotifyError`
// and this test constructs the same class, so both sides must share it.
vi.mock('@/lib/spotify/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/spotify/client')>('@/lib/spotify/client');
  return {
    ...actual,
    spotifyFetch: (endpoint: string, token: string, init?: RequestInit) =>
      spotifyFetchMock(endpoint, token, init),
  };
});

vi.mock('@/lib/spotify/sync', () => ({
  syncTasteProfile: (partnerId: string) => syncTasteProfileMock(partnerId),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));

import { SpotifyError } from '@/lib/spotify/client';
import { GET } from './route';

function eventPartnersTable(eventId = 'event-1') {
  const single = vi.fn().mockResolvedValue({ data: { event_id: eventId }, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  return { select };
}

beforeEach(() => {
  vi.clearAllMocks();
  storeConnectionMock.mockResolvedValue(undefined);
  markConnectionFailedMock.mockResolvedValue(undefined);
  requireUserMock.mockResolvedValue({ id: 'user-partner-1' });
  partnerOwnerMock.mockResolvedValue('user-partner-1');
  exchangeCodeMock.mockResolvedValue({ accessToken: 'A', refreshToken: 'R', expiresIn: 3600 });
  spotifyFetchMock.mockResolvedValue({ id: 'spotify-user' });
  syncTasteProfileMock.mockResolvedValue(undefined);
  from.mockImplementation((table: string) => {
    if (table === 'event_partners') return eventPartnersTable('event-1');
    throw new Error(`unexpected table ${table}`);
  });
});

it('takes partnerId from the COOKIE, never from the query', async () => {
  await GET(req({ code: 'C', state: 'S', partnerId: 'attacker' },
                 { state: 'S', partnerId: 'p1' }));
  expect(storeConnectionMock.mock.calls[0][0].partnerId).toBe('p1');
});

it(
  'redirects to the DECLINED error state when the couple cancels on Spotify\'s consent ' +
    'screen (error=access_denied, no code) — exchangeCode must never be called',
  async () => {
    const res = await GET(
      req({ error: 'access_denied', state: 'S' }, { state: 'S', partnerId: 'p1' }),
    );
    expect(exchangeCodeMock).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('spotify_error=declined');
  },
);

it('refuses when the query state does not match the cookie', async () => {
  await GET(req({ code: 'C', state: 'WRONG' }, { state: 'S', partnerId: 'p1' }));
  expect(exchangeCodeMock).not.toHaveBeenCalled();
});

it('refuses when there is no cookie at all', async () => {
  await GET(req({ code: 'C', state: 'S' }, null));
  expect(exchangeCodeMock).not.toHaveBeenCalled();
});

it('clears the cookie before doing anything else', async () => {
  await GET(req({ code: 'C', state: 'S' }, { state: 'S', partnerId: 'p1' }));
  expect(cookieDelete).toHaveBeenCalledWith('spotify_oauth');
});

it(
  'refuses when the caller does not own partnerId, even with a valid cookie and state ' +
    '(session may have expired mid-flow) -- does NOT store a connection or reach the ' +
    'success redirect',
  async () => {
    partnerOwnerMock.mockResolvedValue('someone-else');
    const res = await GET(req({ code: 'C', state: 'S' }, { state: 'S', partnerId: 'p1' }));
    expect(storeConnectionMock).not.toHaveBeenCalled();
    expect(exchangeCodeMock).not.toHaveBeenCalled();
    expect(res.headers.get('location')).not.toContain('/events/');
    expect(res.headers.get('location')).toContain('spotify_error=');
  },
);

it('PROBES GET /me and stores failed on a 403 — the allowlist case', async () => {
  spotifyFetchMock.mockRejectedValue(new SpotifyError('forbidden', 403, '/me'));
  await GET(req({ code: 'C', state: 'S' }, { state: 'S', partnerId: 'p1' }));
  expect(markConnectionFailedMock).toHaveBeenCalledWith('p1', expect.any(String));
});

it('does NOT store a connection when the probe fails', async () => {
  spotifyFetchMock.mockRejectedValue(new SpotifyError('forbidden', 403, '/me'));
  await GET(req({ code: 'C', state: 'S' }, { state: 'S', partnerId: 'p1' }));
  expect(storeConnectionMock).not.toHaveBeenCalled();
});

it("redirects to the partner's event on success", async () => {
  const res = await GET(req({ code: 'C', state: 'S' }, { state: 'S', partnerId: 'p1' }));
  expect(res.headers.get('location')).toContain('/events/');
});

it('CALLS syncTasteProfile after storing the connection', async () => {
  await GET(req({ code: 'C', state: 'S' }, { state: 'S', partnerId: 'p1' }));
  expect(syncTasteProfileMock).toHaveBeenCalledWith('p1');
});

it(
  "still redirects when sync fails — a connected account with no profile yet is " +
    'better than a dead callback',
  async () => {
    syncTasteProfileMock.mockRejectedValue(new Error('spotify unavailable'));
    const res = await GET(req({ code: 'C', state: 'S' }, { state: 'S', partnerId: 'p1' }));
    expect(res.headers.get('location')).toContain('/events/');
    expect(storeConnectionMock).toHaveBeenCalled();
  },
);

it('clears the cookie before anything else on the SUCCESS path too', async () => {
  await GET(req({ code: 'C', state: 'S' }, { state: 'S', partnerId: 'p1' }));
  // Cookie delete is the FIRST thing that happens after cookie/state
  // validation -- it must run strictly before the token exchange, which is
  // the earliest network call on the success path.
  const deleteOrder = cookieDelete.mock.invocationCallOrder[0];
  const exchangeOrder = exchangeCodeMock.mock.invocationCallOrder[0];
  expect(deleteOrder).toBeLessThan(exchangeOrder);
});
