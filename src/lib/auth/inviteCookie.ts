/**
 * The pending-invite cookie (docs/specs/2026-09-02-new-event-design.md §4.7).
 *
 * WHY A COOKIE AND NOT `?next=` ON emailRedirectTo. Two reasons, and the
 * second alone is decisive:
 *
 * 1. supabase/config.toml calls additional_redirect_urls "a list of *exact*
 *    URLs", and whether a query string still matches an entry is not something
 *    this repo can answer. site-url.ts records what a near-miss of that
 *    allowlist does: it "silently falls back to Site URL with no session and no
 *    visible error."
 * 2. config.toml governs the LOCAL Supabase only. The hosted project's Redirect
 *    URLs live in the Supabase dashboard, outside version control. A `?next=`
 *    design can pass every local test, build green, deploy green, and be dead
 *    on the live site with nothing in this repo to show why.
 *
 * So emailRedirectTo stays byte-identical to the already-allowlisted
 * `${siteUrl()}/auth/callback`, and the destination travels here instead.
 *
 * The same-browser requirement this adds already exists: PKCE keeps its code
 * verifier in a cookie, and /auth/callback already carries a
 * `confirmation_failed_same_browser` reason code for exactly that failure.
 */
export const INVITE_COOKIE = 'spinit_invite';

/**
 * 30 minutes: long enough to open a confirmation email, short enough that a
 * shared machine does not carry someone else's invitation into a later signup.
 */
export const INVITE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 30,
};
