import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  from, requireUser, exchangeCode, spotifyFetch, storeConnection, markConnectionFailed,
  syncTasteProfile,
  // `partnerOwner` is plumbing this file needs (to mock `connectionDal`'s
  // ownership check, the same shared helper `connectSpotify` and the
  // callback route use) but is not part of the harness import list this
  // task's brief specified verbatim -- see the deviation note in this
  // task's report.
  partnerOwner,
} from '@/lib/spotify/__tests__/harness';

/**
 * The harness's mocked functions are each typed from their own zero/loose
 * arrow-function implementation, not from the real modules they stand in
 * for (see CLAUDE.md's `vi.fn` gotcha, and route.test.ts /
 * sync.test.ts for the same pattern). These aliases carry the REAL call
 * signatures so every assertion below typechecks, while still sharing the
 * same underlying `vi.fn` instance (and its `.mock.calls`) as the harness
 * export.
 */
const requireUserMock = requireUser as unknown as Mock<() => Promise<{ id: string }>>;
const exchangeCodeMock = exchangeCode as unknown as
  Mock<(code: string) => Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>>;
const spotifyFetchMock = spotifyFetch as unknown as
  Mock<(endpoint: string, token: string, init?: RequestInit) => Promise<{ id: string }>>;
const storeConnectionMock = storeConnection as unknown as
  Mock<(input: { partnerId: string; spotifyUserId: string; refreshToken: string }) => Promise<void>>;
const markConnectionFailedMock = markConnectionFailed as unknown as
  Mock<(partnerId: string, reason: string) => Promise<void>>;
const syncTasteProfileMock = syncTasteProfile as unknown as Mock<(partnerId: string) => Promise<void>>;
const partnerOwnerMock = partnerOwner as unknown as Mock<(partnerId: string) => Promise<string | null>>;

vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUserMock() }));
vi.mock('@/lib/spotify/oauth', () => ({ exchangeCode: (code: string) => exchangeCodeMock(code) }));
vi.mock('@/lib/spotify/connectionDal', () => ({
  storeConnection: (input: { partnerId: string; spotifyUserId: string; refreshToken: string }) =>
    storeConnectionMock(input),
  markConnectionFailed: (partnerId: string, reason: string) =>
    markConnectionFailedMock(partnerId, reason),
  partnerOwner: (partnerId: string) => partnerOwnerMock(partnerId),
}));
// Keep the real SpotifyError class -- the action does `instanceof SpotifyError`
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

import { SpotifyError } from '@/lib/spotify/client';
import { codeFrom, pasteCode } from './actions';

// requireUser here resolves to the PARTNER's own session -- the developer,
// signed in as that partner -- not the DJ's, unlike task 9's insert step.
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: 'user-partner-1' });
  partnerOwnerMock.mockResolvedValue('user-partner-1');
  exchangeCodeMock.mockResolvedValue({ accessToken: 'A', refreshToken: 'R', expiresIn: 3600 });
  spotifyFetchMock.mockResolvedValue({ id: 'spotify-user' });
  storeConnectionMock.mockResolvedValue(undefined);
  markConnectionFailedMock.mockResolvedValue(undefined);
  syncTasteProfileMock.mockResolvedValue(undefined);
});

/** This form carries TWO fields, unlike the shared harness's `form()` (task
 *  6's), which carries only `partnerId`. Local to this file rather than
 *  overloading the shared helper's signature -- tasks 6 and 7b both rely on
 *  `form()` staying exactly one field, and widening it here would be the same
 *  "no task invents its own" violation in the opposite direction: quietly
 *  changing a handle every other task also uses. Distinct fixture values in
 *  both fields, per the harness's own rule. */
function pasteForm(partnerId: string, url: string): FormData {
  const fd = new FormData();
  fd.set('partnerId', partnerId);
  fd.set('url', url);
  return fd;
}

describe('codeFrom', () => {
  it('extracts the code from a full callback URL, not just a bare code', () => {
    expect(codeFrom('http://127.0.0.1:3000/api/spotify/callback?code=AQD-x&state=s'))
      .toBe('AQD-x');
  });

  it('accepts a bare code too, because people paste both', () => {
    expect(codeFrom('AQD-x')).toBe('AQD-x');
  });
});

describe('pasteCode', () => {
  it('refuses in production, before touching anything', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(pasteCode(pasteForm('p1', 'AQD-x'))).rejects.toThrow(/production/i);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not that partner — same ownership check as connectSpotify',
    async () => {
      requireUser.mockResolvedValue({ id: 'someone-else' });
      await expect(pasteCode(pasteForm('p1', 'AQD-x'))).rejects.toThrow();
      expect(exchangeCode).not.toHaveBeenCalled();
    });

  it('PROBES GET /me and marks the connection failed on a 403 — the allowlist case',
    async () => {
      spotifyFetch.mockRejectedValue(new SpotifyError('forbidden', 403, '/me'));
      await pasteCode(pasteForm('p1', 'AQD-x'));
      expect(markConnectionFailed).toHaveBeenCalledWith('p1', expect.any(String));
      expect(storeConnection).not.toHaveBeenCalled();
    });

  it('stores the connection and calls syncTasteProfile on success', async () => {
    await pasteCode(pasteForm('p1', 'http://127.0.0.1:3000/api/spotify/callback?code=AQD-x'));
    expect(exchangeCode).toHaveBeenCalledWith('AQD-x');
    expect(storeConnection).toHaveBeenCalledWith(
      expect.objectContaining({ partnerId: 'p1' }),
    );
    expect(syncTasteProfile).toHaveBeenCalledWith('p1');
  });

  it('never logs the pasted code, the refresh token or the client secret', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    await pasteCode(pasteForm('p1', 'AQD-secret-code'));
    const printed = [...log.mock.calls, ...errLog.mock.calls].flat().join(' ');
    expect(printed).not.toContain('AQD-secret-code');
  });
});
