# Manual tests — Supabase auth (design 10.4)

Recorded 2026-08-29, updated the same day once test user B was confirmed.
Both test users A and B are now registered and confirmed through the app's
own `/register` form.

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

### Cookie flags (fix-spec F5, part 1 of 2)

**Verified live**, signed in as a real test user, via Chrome DevTools →
Application → Cookies → `localhost`. All six `sb-<project-ref>-auth-token.*`
cookie chunks (Supabase splits a large session cookie into parts) show:

- `HttpOnly`: checked, on every chunk.
- `SameSite`: `Lax`, on every chunk.
- `Secure`: **unchecked** — this is `npm run dev` over plain `http://`, and
  `cookieOptions.secure` is `process.env.NODE_ENV === 'production'`, so
  unchecked here is the correct, expected value, not a defect. Confirming
  this on an actual production deploy (Vercel, HTTPS) is future work once
  one exists.

Also confirms, incidentally: `shouldPromptForProfile` correctly showed the
"Finish your profile" form for this session's test user, whose
`business_name`/`phone` were null at the time.

Only the sign-out half of design 11's cookie-clearing DoD line remains
unverified — see below.

## Design 10.2 RLS cross-user cases — 5 of 6 verified live

Both test users can now sign in. Ran `src/lib/auth/rls.integration.test.ts`
against the live project.

**A real bug was found and fixed in the test itself first, not in the app.**
The suite runs under Vitest's `jsdom` environment, so `window.localStorage`
exists; both test clients used `@supabase/supabase-js`'s default storage
key, which is derived only from the project ref, not per client instance.
Signing in as B silently overwrote A's session in that shared storage, so
every later "client A" call actually ran as B. The first live run therefore
showed "A" reading and updating "B"'s row — which was really B reading and
updating its own row (correctly allowed), not an RLS failure. One of those
test writes landed for real in test user B's live `profiles` row and was
cleaned up separately (not application data, a test fixture). Fixed by
passing `persistSession: false` to each client so their sessions can never
collide (commit `b53eda8`).

1. A reading B's profile by id returns zero rows — **verified**, live.
2. A updating B's profile affects zero rows — **verified**, live.
3. A updating their own row and attempting to change `id` to B's is
   rejected — **verified**, live.
4. A direct client `insert` into `profiles` is rejected — **verified**, live.
5. After creating a user, `signUp` succeeds with valid metadata — **blocked**,
   not failed. Supabase's built-in mailer caps at 2 emails/hour project-wide;
   this hour's budget was already spent creating the test fixtures and by an
   earlier unconfirmed registration attempt. The live call returns
   `AuthApiError` `over_email_send_rate_limit` (429), not a trigger or RLS
   error. Will pass once the budget resets; not re-verified in this session.
   **Even once it passes, this case can only verify that `signUp` did not
   error** (i.e. the trigger ran without hitting a check constraint) — it
   cannot verify the resulting row's content without the service-role key,
   which stays out of this codebase entirely (design 8.1). The row's content
   (full_name carried through from metadata) is verified separately via the
   DB read-only check already documented under "Confirmation email" above,
   for test user A.
6. Negative trigger case — over-length metadata is rejected and creates no
   `auth.users` row — **verified**, live, and specifically confirmed to be a
   genuine trigger/constraint rejection rather than a rate-limit false
   pass: this case's assertion was hardened (commit `ff4052b`) to check the
   error is *not* the rate-limit error, since it runs right after case 5
   spends the same mailer budget. It still passed with a distinct error
   after hardening, confirming GoTrue rejects the trigger's failed insert
   before ever attempting to send mail — this case doesn't touch the
   mailer budget at all, unlike case 5.

`npm test` currently fails on exactly one case (case 5, the mailer
rate limit above) — everything else in the suite passes, 5/6 RLS cases
included.

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
  pass.** Nearly met. `npm run lint` (fixed separately, commit `2a4aff1` —
  `eslint.config.mjs`'s `.next/**` ignore didn't match a nested worktree's
  build output; now `**/.next/**` plus `.claude/**`), `npm run typecheck`,
  and `npm run build` all pass cleanly. `npm test` fails on exactly one
  case — the RLS suite's case 5, blocked on the mailer's hourly rate limit,
  not a defect (see above) — everything else, 86 of 87 tests, passes.
- **`npm audit` reports no critical or high findings.** Met — `npm audit`
  reports 0 vulnerabilities.
- **README documents the environment variables, the local Supabase setup
  steps, and the Supabase dashboard configuration steps.** Met — reviewed
  and left as-is; the existing table and P1-P6 steps in `README.md` are
  accurate and already correctly describe Google OAuth as deferred rather
  than supported.
