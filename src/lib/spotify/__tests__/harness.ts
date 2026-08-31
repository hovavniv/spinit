// src/lib/spotify/__tests__/harness.ts
import { vi } from 'vitest';

export const from        = vi.fn();
export const connUpsert  = vi.fn(async () => ({ data: [{}], error: null }));
export const tokenUpsert = vi.fn(async () => ({ data: [{}], error: null }));
export const tokenDelete = vi.fn(async () => ({ data: [{ partner_id: 'p1' }], error: null }));
export const cookieSet    = vi.fn();
export const cookieDelete = vi.fn();
export const cookieGet    = vi.fn();

/** connectionDal.ts, mocked for task 7's callback test and task 8's sync test. */
export const tokenSelect         = vi.fn(async () => ({ data: null, error: null }));
export const profileUpsert       = vi.fn(async () => ({ data: [{}], error: null }));
export const storeConnection     = vi.fn(async () => undefined);
export const markConnectionFailed = vi.fn(async () => undefined);
/** connectionDal.ts's shared ownership lookup (task 6/7 fix wave). Defaults
 *  to the same id `requireUser` resolves, so existing happy-path tests that
 *  never set this explicitly still pass an ownership check. */
export const partnerOwner = vi.fn(async () => 'user-partner-1');

/** oauth.ts, mocked for task 5's connectionDal test and task 8's sync test. */
export const refreshAccessToken = vi.fn(async () => ({ accessToken: 'ACCESS', refreshToken: 'REFRESH' }));
export const exchangeCode       = vi.fn(async () => ({ accessToken: 'ACCESS', refreshToken: 'REFRESH' }));

/** client.ts (slice B), mocked for task 7's callback test and task 8's sync test. */
export const spotifyFetch = vi.fn(async () => ({ items: [] }));

/** sync.ts, mocked for task 7's callback test. */
export const syncTasteProfile = vi.fn(async () => undefined);

/** redirect() works by THROWING. Mocking it to return would make every
 *  `rejects.toThrow()` in tasks 6 and 7b vacuous. */
export const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${url}` });
});

export const requireUser = vi.fn(async () => ({ id: 'user-partner-1' }));

/** A form with ONE field set. Distinct values per field, always. */
export function form(partnerId: string): FormData {
  const fd = new FormData();
  fd.set('partnerId', partnerId);
  return fd;
}

/** A callback Request plus the cookie the callback will read. */
export function req(
  query: Record<string, string>,
  cookie: { state: string; partnerId: string } | null,
) {
  cookieGet.mockReturnValue(cookie ? { value: JSON.stringify(cookie) } : undefined);
  const u = new URL('http://127.0.0.1:3000/api/spotify/callback');
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return new Request(u);
}
