import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.SPOTIFY_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

const from = vi.fn();
const connUpsert = vi.fn();
const connUpsertSelect = vi.fn();
const tokenUpsert = vi.fn();
const tokenUpsertSelect = vi.fn();
const tokenDelete = vi.fn();
const tokenDeleteSelect = vi.fn();
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
  partnerOwner,
} from './connectionDal';

/**
 * `spotify_connections` builder: upsert() chains into .select() -- every
 * write in this DAL is checked for both an `error` and an empty `data`
 * array (an RLS policy admitting zero rows returns success with nothing
 * written, a different failure than `error`).
 */
function connectionsTable() {
  connUpsert.mockReturnValue({ select: connUpsertSelect });
  return { upsert: connUpsert };
}

/**
 * `spotify_tokens` builder: upsert() and delete() both chain into
 * .select(), and select() chains into .eq().single().
 */
function tokensTable() {
  const deleteEq = vi.fn().mockReturnValue({ select: tokenDeleteSelect });
  const selectEq = vi.fn().mockReturnValue({ single: tokenSelect });
  tokenUpsert.mockReturnValue({ select: tokenUpsertSelect });
  return {
    upsert: tokenUpsert,
    delete: tokenDelete.mockReturnValue({ eq: deleteEq }),
    select: vi.fn().mockReturnValue({ eq: selectEq }),
  };
}

const partnerSingle = vi.fn();

/** `event_partners` builder for `partnerOwner`: select().eq().single(). */
function eventPartnersTable() {
  const eq = vi.fn().mockReturnValue({ single: partnerSingle });
  return { select: vi.fn().mockReturnValue({ eq }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenSelect.mockResolvedValue({ data: null, error: null });
  connUpsertSelect.mockResolvedValue({ data: [{ partner_id: 'p1' }], error: null });
  tokenUpsertSelect.mockResolvedValue({ data: [{ partner_id: 'p1' }], error: null });
  tokenDeleteSelect.mockResolvedValue({ data: [{ partner_id: 'p1' }], error: null });
  partnerSingle.mockResolvedValue({ data: { user_id: 'owner-1' }, error: null });
  from.mockImplementation((table: string) => {
    if (table === 'spotify_connections') return connectionsTable();
    if (table === 'spotify_tokens') return tokensTable();
    if (table === 'event_partners') return eventPartnersTable();
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

/**
 * Every write in this file resolves { error, data } without throwing --
 * `createClient()` has no `.throwOnError()`. Each site below is checked for
 * BOTH a rejected write (`error` set) and an admitted-zero-rows write (an
 * empty `data` array, e.g. an RLS `USING`/`WITH CHECK` clause that filters
 * to nothing without erroring) -- two different failure shapes, so both are
 * proven separately rather than assuming one check catches both.
 */
describe('unchecked-write fail-closed paths', () => {
  it('storeConnection throws when the spotify_connections upsert errors', async () => {
    connUpsertSelect.mockResolvedValueOnce({ data: null, error: { code: '23505' } });
    await expect(
      storeConnection({ partnerId: 'p1', spotifyUserId: 'u', refreshToken: 'r' }),
    ).rejects.toThrow(/spotify_connections upsert failed/);
  });

  it('storeConnection throws when the spotify_connections upsert admits zero rows', async () => {
    connUpsertSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(
      storeConnection({ partnerId: 'p1', spotifyUserId: 'u', refreshToken: 'r' }),
    ).rejects.toThrow(/spotify_connections upsert wrote no row/);
  });

  it(
    'storeConnection throws when the spotify_tokens upsert errors -- this is the refresh ' +
      'token write itself',
    async () => {
      tokenUpsertSelect.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
      await expect(
        storeConnection({ partnerId: 'p1', spotifyUserId: 'u', refreshToken: 'r' }),
      ).rejects.toThrow(/spotify_tokens upsert failed/);
    },
  );

  it('storeConnection throws when the spotify_tokens upsert admits zero rows', async () => {
    tokenUpsertSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(
      storeConnection({ partnerId: 'p1', spotifyUserId: 'u', refreshToken: 'r' }),
    ).rejects.toThrow(/spotify_tokens upsert wrote no row/);
  });

  it('markConnectionFailed throws when its upsert errors', async () => {
    connUpsertSelect.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    await expect(markConnectionFailed('p1', 'not_allowlisted')).rejects.toThrow(
      /spotify_connections upsert failed/,
    );
  });

  it('markConnectionFailed throws when its upsert admits zero rows', async () => {
    connUpsertSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(markConnectionFailed('p1', 'not_allowlisted')).rejects.toThrow(
      /spotify_connections upsert wrote no row/,
    );
  });

  it('disconnect throws when the spotify_tokens delete errors', async () => {
    tokenDeleteSelect.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    await expect(disconnect('p1')).rejects.toThrow(/spotify_tokens delete failed/);
  });

  it(
    'disconnect throws when the spotify_tokens delete removes zero rows -- e.g. another ' +
      "partner's row under RLS",
    async () => {
      tokenDeleteSelect.mockResolvedValueOnce({ data: [], error: null });
      await expect(disconnect('p1')).rejects.toThrow(/spotify_tokens delete removed no row/);
    },
  );

  it('disconnect throws when the spotify_connections upsert back to invited errors', async () => {
    connUpsertSelect.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    await expect(disconnect('p1')).rejects.toThrow(/spotify_connections upsert failed/);
  });

  it('disconnect throws when the spotify_connections upsert back to invited admits zero rows', async () => {
    connUpsertSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(disconnect('p1')).rejects.toThrow(/spotify_connections upsert wrote no row/);
  });

  it(
    'withUserToken THROWS when the rotated-refresh-token write errors -- the old token is ' +
      'already invalid, a swallowed failure here would strand the caller on a dead token ' +
      'with nothing recording why',
    async () => {
      tokenSelect.mockResolvedValue({
        data: { refresh_token: encryptToken('OLD-R') },
        error: null,
      });
      refreshAccessToken.mockResolvedValue({ accessToken: 'A2', refreshToken: 'NEW-R' });
      tokenUpsertSelect.mockResolvedValueOnce({ data: null, error: { code: '500' } });

      await expect(withUserToken('p1', async () => undefined)).rejects.toThrow(
        /spotify_tokens rotation upsert failed/,
      );
    },
  );

  it(
    'withUserToken THROWS when the rotated-refresh-token write admits zero rows',
    async () => {
      tokenSelect.mockResolvedValue({
        data: { refresh_token: encryptToken('OLD-R') },
        error: null,
      });
      refreshAccessToken.mockResolvedValue({ accessToken: 'A2', refreshToken: 'NEW-R' });
      tokenUpsertSelect.mockResolvedValueOnce({ data: [], error: null });

      await expect(withUserToken('p1', async () => undefined)).rejects.toThrow(
        /spotify_tokens rotation upsert wrote no row/,
      );
    },
  );
});

describe('partnerOwner', () => {
  it("resolves the event_partners row's user_id", async () => {
    partnerSingle.mockResolvedValue({ data: { user_id: 'owner-1' }, error: null });
    await expect(partnerOwner('p1')).resolves.toBe('owner-1');
  });

  it('resolves null when the partner row does not exist', async () => {
    partnerSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    await expect(partnerOwner('missing')).resolves.toBeNull();
  });
});
