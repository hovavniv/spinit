# Manual tests

## Supabase auth (design 10.4)

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