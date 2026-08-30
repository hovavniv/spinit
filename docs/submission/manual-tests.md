# Manual tests

## Supabase auth (design 10.4)

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
  for that session.** Met, for the cookie-clearing half — verified live: on
  the same signed-in session used for the cookie-flags check above, clicking
  "Sign out" removed all six `sb-<project-ref>-auth-token.*` cookie chunks
  from DevTools' Cookies panel, and a subsequent request to `/dashboard`
  redirected to `/login` (proxy guard re-engaged, as expected). The second
  half — that a previously-issued access JWT copied before sign-out remains
  valid until its own expiry regardless — is a documented, accepted gap
  (security-gaps.md gap 7), not something sign-out is meant to close; not
  independently re-tested here beyond what that gap already states.
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

---

## DJ Dashboard screen (visual slice)

**Date:** 2026-08-29
**What was compared:** `/design/dashboard` (the preview route, rendering `DashboardScreen` from
`demoData`) against `design/artboards/Spinit DJ Dashboard.dc.html`, the visual source of truth.
**How:** a headless Chromium session against the real dev server, screenshotted at desktop width
(1440px) and at 400px — not a source-level diff of declared CSS values, which cannot see actual
layout geometry.

### Desktop (1440px)

Matches the artboard: dark 240px sidebar with the two decorative circles, the DJ chip at the
bottom; greeting header with the eyebrow, "+ New event"; the pink live-event banner; the two-column
upcoming-events grid with both status pills rendering distinct fills and wording; the stacked
past-events rows. No visual regressions against the artboard.

### ~400px

Confirmed the responsive collapse from design §8: the sidebar becomes a full-width top strip (logo
+ nav in a row, avatar chip on the right, name/company dropped), the upcoming-events grid drops to
one column, main padding shrinks to 24px, past-event rows wrap.

**One real defect found and fixed during this check, not caught by any source-level review:** the
mobile sidebar strip's decorative circles (`.blobPink`, `.blobIndigo`) are `position: absolute`,
which requires a positioned ancestor. The design doc specified `position: static` for the collapsed
sidebar (to make it non-sticky). Setting the sidebar to `static` removes it as a positioning
context, so the circles escaped the sidebar's `overflow: hidden` entirely and floated relative to
the whole page — a large stray translucent shape bled down over the live-event banner and the
upcoming-events cards. Fixed by using `position: relative` instead, which is visually identical to
`static` for a box that was never `fixed`, but keeps the circles contained. Verified via a DOM
geometry check (`getBoundingClientRect()` on the sidebar and both blobs before and after) and a
second screenshot showing the stray shape gone. This fix is committed as part of Task 9's own
commit, alongside the rest of the responsive rules, since it's a correction to the same block of
CSS the task added — not a separate change.

### Known divergence (deliberate, not a bug)

The artboard's own eyebrow reads "Tuesday, August 27". 2026-08-27 is actually a **Thursday**
(`date -j -f "%Y-%m-%d" "2026-08-27" "+%A"` → `Thursday`). The implementation renders the correct
weekday rather than reproducing the artboard's error — recorded in design doc §5 and pinned by
`format.test.ts`.

### Not tested

CSS is not covered by automated tests — checked by eye against the artboard, as recorded above.

---

## Full verification (Task 10)

Run from the worktree root, 2026-08-29, all commands run and their real exit codes read:

```
$ npm run typecheck
> tsc --noEmit
(no output — exit 0)

$ npm run lint
> eslint
(no output — exit 0)

$ npm test -- --run
 Test Files  6 passed (6)
      Tests  56 passed (56)
(exit 0)

$ npm run build
▲ Next.js 16.3.3 (Turbopack)
✓ Compiled successfully in 2.1s
✓ Generating static pages using 8 workers (7/7)

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /design/dashboard
├ ○ /login
└ ○ /register
(exit 0)
```

`git status` at the end of the task shows nothing unexpected under `src/`, and
`src/app/dashboard/page.tsx` was never created — confirmed via `ls src/app/dashboard`, which
reports "No such file or directory". That route belongs to `feat/supabase-auth` Task 10, not this
slice.

### A second real defect, found while trying to commit this file

`.gitignore`'s `!docs/submission/` negation (added in commit `ba20e9f`, before this task ran) does
not actually work: `git add docs/submission/manual-tests.md` was refused as ignored. `docs/` is a
bare directory pattern, and git never descends into an excluded directory to evaluate further
rules — no negation of a path underneath it can re-include anything, regardless of how it's
written (confirmed: neither `!docs/submission/` alone nor adding `!docs/submission/**` fixed it).
The working fix is `docs/*` (excludes only `docs`'s direct children, which git does still descend
into) instead of `docs/`, so the negation on `docs/submission/` actually takes effect. Verified with
`git check-ignore -v`: `docs/submission/manual-tests.md` is no longer ignored, while
`docs/specs/2026-08-29-dj-dashboard-plan.md` still is. This means the earlier commit's claim — "gitignore
un-ignores docs/submission" — was never actually exercised; it's corrected here rather than left
standing.