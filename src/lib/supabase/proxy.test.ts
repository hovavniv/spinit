import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Pins F5 (fix-spec 2026-08-29): `proxy.ts` builds its own `cookieOptions`
 * object — `@supabase/ssr`'s own default is `httpOnly: false` with `secure`
 * unset, which would produce a non-HttpOnly, non-Secure auth cookie (design
 * 8.5, design 2.7). This test imports the real `proxy.ts` and asserts what
 * it actually passes as the third argument to `createServerClient`, so a
 * silent regression (e.g. dropping `httpOnly: true`) fails a test instead of
 * only every existing test — which all mock `@/lib/supabase/proxy` wholesale
 * — staying green.
 *
 * `proxy.ts` has no `server-only` import and needs a real `NextRequest`,
 * which `next/server` provides directly and is safe to construct under
 * jsdom. `server.ts`'s identical `cookieOptions` object could not be pinned
 * the same way here: it additionally imports the bare specifier
 * `server-only`, which has no real npm package installed in this repo (Next
 * aliases it internally to a compiled empty module at build time) and no
 * `vitest.config.ts` alias either, so Vitest's own module resolution fails
 * before any `vi.mock('server-only', ...)` in a test file gets a chance to
 * intercept it — see this task's report for detail.
 */

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(
    (_url: string, _key: string, options: { cookieOptions: Record<string, unknown> }) => ({ options }),
  ),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}));

describe('supabase/proxy createClient cookie options', () => {
  it('passes httpOnly, sameSite, and path flags through to createServerClient', async () => {
    const { createClient } = await import('./proxy');
    const request = new NextRequest('https://example.com/some-path');

    createClient(request);

    expect(createServerClientMock).toHaveBeenCalledTimes(1);
    const [, , options] = createServerClientMock.mock.calls[0];
    const cookieOptions = options.cookieOptions;

    expect(cookieOptions.httpOnly).toBe(true);
    expect(cookieOptions.sameSite).toBe('lax');
    expect(cookieOptions.path).toBe('/');
    expect(cookieOptions).toHaveProperty('secure');
  });
});
