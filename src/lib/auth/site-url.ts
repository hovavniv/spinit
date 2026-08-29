/**
 * `SITE_URL`, never a request header — a forged `Host` / `X-Forwarded-Host`
 * header must not be able to influence a Supabase redirect URL (design 4.1,
 * design 4.3's open-redirect concern). This function does not read
 * `headers()` at all, which is itself the control: there is no code path
 * here that could be tricked into preferring a client-supplied origin.
 *
 * Shared between `actions.ts` and `app/auth/callback/route.ts` — both build
 * redirect URLs off this same origin, and both need the same trailing-slash
 * guard: `SITE_URL=http://localhost:3000/` (trailing slash) would otherwise
 * produce a double slash (`.../` + `/auth/callback`) that fails Supabase's
 * exact Redirect URL allowlist match and silently falls back to Site URL
 * with no session and no visible error (design 8.4).
 */
export function siteUrl(): string {
  const url = process.env.SITE_URL;
  if (!url) {
    throw new Error('SITE_URL is not set');
  }
  return url.replace(/\/$/, '');
}
