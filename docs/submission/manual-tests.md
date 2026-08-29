# Manual tests — Supabase auth (design 10.4)

Recorded 2026-08-29. This run is deliberately partial: test user A
(registered through the app's own `/register` form) is confirmed and
usable; test user B is registered but not yet confirmed (its confirmation
email did not arrive), so anything that needs a second working user is
blocked. See `docs/specs/2026-08-29-supabase-auth-ledger.md` for status.

No real email addresses, passwords, or user ids are recorded in this file;
test users are referenced generically as "test user A" / "test user B".

## Design 10.4 manual tests

### Google round-trip

**Blocked — not applicable yet.** Google OAuth is deferred (GitHub issue
#2); `signInWithGoogle` does not exist in this codebase. Nothing to click
through. This is not a failure of an existing feature — it is a feature not
yet built.

### Confirmation email

**Verified as evidence, not re-clicked live.** Test user A already
performed this exact flow for real earlier in this project: signed up
through `/register`, received Supabase's stock confirmation email, clicked
the link in the same browser used to sign up, and landed on `/dashboard`.
I did not repeat that live browser click myself in this session. What I did
verify, as end-state evidence, by running a read-only query against the
linked project via `supabase db query --linked` (the project's own
management-API connection — no service-role key used):

- Test user A's `auth.users` row has `email_confirmed_at` non-null
  (confirmed: true).
- A matching `public.profiles` row exists for that same user id, with
  `full_name`, `business_name`, and `phone` all populated (non-null).

This confirms the end state the confirmation flow is supposed to produce
(confirmed user + trigger-created profile with metadata), but it is DB-state
evidence, not a fresh live click-through in this session.

Test user B has not completed this flow: `email_confirmed_at` is null for
that row, consistent with its confirmation email not having arrived.

### Proxy guard

**Verified, fresh this session.**

```
$ curl -sI localhost:3000/dashboard
HTTP/1.1 307 Temporary Redirect
location: /login
```

Requesting `/dashboard` signed out redirects to `/login` with a 307, as
expected.

## Design 10.2 RLS cross-user cases — BLOCKED on user B

All of the following require both test users signed in; user B cannot sign
in yet ("Email not confirmed"). Blocked, not failed. See
`docs/specs/2026-08-29-supabase-auth-ledger.md` for status and next steps.

1. A reading B's profile by id returns zero rows — BLOCKED.
2. A updating B's profile affects zero rows — BLOCKED.
3. A updating their own row and attempting to change `id` to B's is
   rejected — BLOCKED.
4. A direct client `insert` into `profiles` is rejected — BLOCKED (does not
   strictly need user B, but is exercised in the same blocked suite run).
5. After creating a user, a profile row exists with the metadata carried
   through — BLOCKED (needs a live `signUp` in the same gated suite run).
6. Negative trigger case — over-length metadata is rejected and creates no
   `auth.users` row — BLOCKED (same reason as case 5).

`npm test` currently fails at this suite's `beforeAll` with "Failed to sign
in test user B: Email not confirmed" (`src/lib/auth/rls.integration.test.ts`).
All 6 cases inside report as skipped once the suite itself fails at setup;
this is the expected, known-blocked state, not a regression.

## Definition of done walk-through (design section 11)

- **A DJ can register with email and password, confirm by email, and reach
  `/dashboard`.** Met — verified via the confirmation-email evidence above
  (test user A).
- **A DJ can sign in with Google and reach `/dashboard`.** Not applicable —
  Google OAuth is deferred (issue #2); no such path exists yet.
- **A Google user is prompted for business name and phone, and saving
  persists.** Not applicable — same reason; there is no Google user.
- **`/dashboard` is unreachable signed out.** Met — verified via the proxy
  guard test above (307 to `/login`).
- **Sign out clears the auth cookies and no new access token can be minted
  for that session.** Not verified in this session — this needs a live
  sign-in/sign-out round trip with cookie inspection, which was not run as
  part of this partial pass. I did not check this.
- **The signup email template is left at its stock
  `{{ .ConfirmationURL }}`; `site_url` and `additional_redirect_urls` are
  pushed and match `SITE_URL`.** Met — carried forward from earlier tasks
  (P3/P4 in the plan, already applied and verified); not independently
  re-verified in this session.
- **`npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all
  pass.** Partially met. `npm run typecheck` and `npm run build` pass.
  `npm test` fails at the RLS integration suite's `beforeAll` for the reason
  above (expected, blocked on user B). `npm run lint` reports errors, but
  every one of them is inside `.claude/worktrees/dj-dashboard/.next/`, a
  stray build-output directory from an unrelated worktree elsewhere on this
  machine, not from this project's own `src/` tree; `npx eslint src` is
  clean (exit 0). This looks like an ESLint config gap (`.next/**` in
  `eslint.config.mjs` is not being applied to nested worktree paths) rather
  than an issue in any file this task touched — flagged, not fixed, since
  `eslint.config.mjs` is outside this task's scope.
- **`npm audit` reports no critical or high findings.** Met — `npm audit`
  reports 0 vulnerabilities.
- **README documents the environment variables, the local Supabase setup
  steps, and the Supabase dashboard configuration steps.** Met — reviewed
  and left as-is; the existing table and P1-P6 steps in `README.md` are
  accurate and already correctly describe Google OAuth as deferred rather
  than supported.
