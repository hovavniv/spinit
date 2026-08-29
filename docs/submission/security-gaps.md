# Known security gaps — stub

This is a stub carrying forward the known gaps identified during the
Supabase-auth design (`docs/specs/2026-08-28-supabase-auth-design.md`,
section 9) so they are not lost between now and deliverable 8, the full
security document, which is a later chunk of work. Each item below is a
one-line-to-short-paragraph pointer, not the full writeup.

## The 11 gaps from the design (section 9)

1. **Email + password retained** despite secure-coding rule 1 prohibiting it.
   Google OAuth is meant to be the compliant path and offered first; password
   auth is kept for design fidelity and grader access without a Google
   account.
2. **Built-in SMTP** is rate-limited to exactly 2 emails/hour, project-wide,
   shared across signup/recovery/etc. Adequate for a single controlled demo,
   fragile for anything busier. Fix: custom SMTP (e.g. Resend).
3. **No application-level rate limiting** on login/registration beyond
   Supabase Auth's built-in per-IP limits. Secure-coding rule 21 wants
   stricter limits specifically. Fix: a rate limiter in front of the auth
   actions with a shared store (e.g. Upstash Redis).
4. **No CSP** (Content-Security-Policy header) yet.
5. **No password reset.** The "Forgot password?" link in the design remains
   inert.
6. **Emails are not deduplicated across providers** — signing up with a
   password and then with Google at the same address may produce two
   identities depending on Supabase's linking configuration. Out of scope
   so far; the observed behaviour has not been verified.
7. **A copied cookie outlives `signOut()`.** Sign-out revokes the refresh
   token and clears cookies, but a previously issued access JWT is stateless
   and stays valid until its own expiry (default 1 hour). What is mitigated:
   `secure_password_change = true` blocks turning a stolen bearer token into
   a permanent password takeover via `PATCH /auth/v1/user`. What is not
   mitigated: the one-hour read window itself is unclosed.
8. **`data.user.identities` is an unmapped enumeration channel** — readable
   directly from Supabase's public signup endpoint, it reveals whether an
   email is already confirmed, bypassing this app's own error mapper.
9. **The RLS integration tests are not reproducible from the repo alone.**
   They depend on two users registered once, by hand, through the app's own
   `/register` form against the hosted project — coupling the suite to the
   register flow (a signup regression breaks the RLS tests too). Fix: move
   to a local `supabase start` Docker stack once available, seeded from a
   migration so both users can be created idempotently by a setup script.
10. **Confirmation links are single-browser, single-signup-at-a-time.**
    Email template customisation is unavailable on the free tier, so the
    `token_hash` flow is off the table and confirmation relies on Supabase's
    stock link plus a redirect to `/auth/callback`. The PKCE code verifier
    lives under one fixed cookie name, so a second signup started before the
    first link is clicked breaks both. Fix: custom SMTP, which also lifts
    gap 2's rate cap.
11. **No session expiry or idle timeout.** Secure-coding rule 14 requires
    both; `enable_refresh_token_rotation = true` with no `timebox` /
    `inactivity_timeout` set means a session can live indefinitely as long
    as it keeps refreshing. Inactivity timeout is gated to Pro-plan projects
    and above, so this is unfixable on the free tier as currently scoped.
    `jwt_expiry` (currently the 3600-second default) is the one lever
    available on the free tier, and it partially mitigates both this gap and
    gap 7.

## Gap 12 — current-state gap, not in the original 11

The original 11 gaps (in particular gap 1) assumed Google OAuth would exist
*alongside* password auth, with Google offered as the compliant path and
password auth kept as a secondary option. That assumption does not hold
today: Google OAuth is deferred (GitHub issue #2) and `signInWithGoogle`
does not exist in this codebase yet. As things stand right now, **email +
password is the only auth method available at all** — which is exactly the
method secure-coding rule 1 prohibits, with no compliant alternative
currently offered alongside it. This is a materially worse position than
gap 1 as originally scoped, and stays open until Google OAuth (issue #2)
ships.
