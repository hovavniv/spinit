import { describe, expect, it, vi } from 'vitest';

/**
 * Pins F5 (fix-spec 2026-08-29): `server.ts` builds its own `cookieOptions`
 * object — `@supabase/ssr`'s own default is `httpOnly: false` with `secure`
 * unset, which would produce a non-HttpOnly, non-Secure auth cookie (design
 * 8.5, design 2.7). This test imports the real `server.ts` and asserts what
 * it actually passes as the third argument to `createServerClient`, so a
 * silent regression (e.g. dropping `httpOnly: true`) fails a test instead of
 * only every existing test — which all mock `@/lib/supabase/server` wholesale
 * — staying green.
 *
 * `server.ts` also carries `import 'server-only'`, which has no real npm
 * package installed in this repo — Next aliases it internally to a compiled
 * empty module at build time. `vitest.config.ts` now carries the matching
 * `resolve.alias` entry (mirroring Next's own Jest integration exactly),
 * which is what makes this import resolvable under Vitest at all.
 */

const { createServerClientMock, cookiesMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(
    (_url: string, _key: string, options: { cookieOptions: Record<string, unknown> }) => ({ options }),
  ),
  cookiesMock: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}));

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

describe('supabase/server createClient cookie options', () => {
  it('passes httpOnly, sameSite, and path flags through to createServerClient', async () => {
    const { createClient } = await import('./server');

    await createClient();

    expect(createServerClientMock).toHaveBeenCalledTimes(1);
    const [, , options] = createServerClientMock.mock.calls[0];
    const cookieOptions = options.cookieOptions;

    expect(cookieOptions.httpOnly).toBe(true);
    expect(cookieOptions.sameSite).toBe('lax');
    expect(cookieOptions.path).toBe('/');
    expect(cookieOptions).toHaveProperty('secure');
  });
});
