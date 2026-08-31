import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.SPOTIFY_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

const from = vi.fn();
const connUpsert = vi.fn();
const tokenUpsert = vi.fn();
const tokenDelete = vi.fn();
const tokenSelect = vi.fn();
const refreshAccessToken = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));
vi.mock('./oauth', () => ({ refreshAccessToken: (...args: unknown[]) => refreshAccessToken(...args) }));

import { encryptToken } from './crypto';
import {
  storeConnection,
  markConnectionFailed,
  disconnect,
  withUserToken,
} from './connectionDal';

/**
 * `spotify_connections` builder: upsert() resolves directly (no .select()
 * chain needed for the connection table in this DAL).
 */
function connectionsTable() {
  return { upsert: connUpsert.mockResolvedValue({ error: null }) };
}

/**
 * `spotify_tokens` builder: upsert() resolves directly; delete() chains into
 * .select() (so a zero-row delete is detectable), and select() chains into
 * .eq().single().
 */
function tokensTable() {
  const deleteSelect = vi.fn().mockResolvedValue({ data: [{ partner_id: 'p1' }], error: null });
  const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect });
  const selectEq = vi.fn().mockReturnValue({ single: tokenSelect });
  return {
    upsert: tokenUpsert.mockResolvedValue({ error: null }),
    delete: tokenDelete.mockReturnValue({ eq: deleteEq }),
    select: vi.fn().mockReturnValue({ eq: selectEq }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenSelect.mockResolvedValue({ data: null, error: null });
  from.mockImplementation((table: string) => {
    if (table === 'spotify_connections') return connectionsTable();
    if (table === 'spotify_tokens') return tokensTable();
    throw new Error(`unexpected table ${table}`);
  });
});

describe('storeConnection', () => {
  it('stores the refresh token ENCRYPTED, never in plaintext', async () => {
    await storeConnection({ partnerId: 'p1', spotifyUserId: 'u', refreshToken: 'AQD-plain' });
    const written = tokenUpsert.mock.calls[0][0] as { refresh_token: string };
    expect(written.refresh_token).not.toContain('AQD-plain');
    expect(written.refresh_token.startsWith('v1.')).toBe(true);
  });

  it('writes the connection and the token as separate rows in separate tables', async () => {
    await storeConnection({ partnerId: 'p1', spotifyUserId: 'u', refreshToken: 'r' });
    expect(from).toHaveBeenCalledWith('spotify_connections');
    expect(from).toHaveBeenCalledWith('spotify_tokens');
  });

  it('UPSERTS both, so reconnecting does not fail on an existing row', async () => {
    await storeConnection({ partnerId: 'p1', spotifyUserId: 'u', refreshToken: 'r' });
    expect(connUpsert).toHaveBeenCalledWith(expect.anything(), { onConflict: 'partner_id' });
    expect(tokenUpsert).toHaveBeenCalledWith(expect.anything(), { onConflict: 'partner_id' });
  });
});

describe('markConnectionFailed', () => {
  it('marks the connection failed with a reason, without leaking provider text', async () => {
    await markConnectionFailed('p1', 'not_allowlisted');
    expect(connUpsert.mock.calls[0][0]).toMatchObject({ status: 'failed' });
  });
});

describe('disconnect', () => {
  it('disconnect deletes the token and returns the connection to invited', async () => {
    await disconnect('p1');
    expect(tokenDelete).toHaveBeenCalled();
    expect(connUpsert.mock.calls[0][0]).toMatchObject({ status: 'invited' });
  });
});

describe('withUserToken', () => {
  it('keeps the stored refresh token when a refresh omits one', async () => {
    tokenSelect.mockResolvedValue({
      data: { refresh_token: encryptToken('OLD-R') },
      error: null,
    });
    refreshAccessToken.mockResolvedValue({ accessToken: 'A2', refreshToken: 'OLD-R' });

    await withUserToken('p1', async () => undefined);

    // Nothing rotated, so nothing is written back.
    expect(tokenUpsert).not.toHaveBeenCalled();
  });

  it('writes back a ROTATED refresh token, re-encrypted', async () => {
    tokenSelect.mockResolvedValue({
      data: { refresh_token: encryptToken('OLD-R') },
      error: null,
    });
    refreshAccessToken.mockResolvedValue({ accessToken: 'A2', refreshToken: 'NEW-R' });

    await withUserToken('p1', async () => undefined);

    const written = tokenUpsert.mock.calls[0][0] as { refresh_token: string };
    expect(written.refresh_token.startsWith('v1.')).toBe(true);
    expect(written.refresh_token).not.toContain('NEW-R');
  });

  it('sets updated_at explicitly on rotation — the column has no moddatetime trigger', async () => {
    tokenSelect.mockResolvedValue({
      data: { refresh_token: encryptToken('OLD') },
      error: null,
    });
    refreshAccessToken.mockResolvedValue({ accessToken: 'A', refreshToken: 'NEW' });

    await withUserToken('p1', async () => undefined);

    expect(tokenUpsert.mock.calls[0][0]).toHaveProperty('updated_at');
  });

  it('passes the fresh access token to the callback and returns its result', async () => {
    tokenSelect.mockResolvedValue({
      data: { refresh_token: encryptToken('OLD') },
      error: null,
    });
    refreshAccessToken.mockResolvedValue({ accessToken: 'A2', refreshToken: 'OLD' });

    const fn = vi.fn().mockResolvedValue('done');
    const result = await withUserToken('p1', fn);

    expect(fn).toHaveBeenCalledWith('A2');
    expect(result).toBe('done');
  });
});
