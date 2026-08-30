# Manual tests

## Supabase auth (design 10.4)

Recorded 2026-08-29, updated the same day once test user B was confirmed.
Both test users A and B are now registered and confirmed through the app's
own `/register` form.

No real email addresses, passwords, or user ids are recorded in this file;
test users are referenced generically as "test user A" / "test user B".

### Design 10.4 manual tests

#### Google round-trip

**Blocked — not applicable yet.** Google OAuth is deferred (GitHub issue
#2); `signInWithGoogle` does not exist in this codebase. Nothing to click
through. This is not a failure of an existing feature — it is a feature not
yet built.

#### Confirmation email

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

#### Proxy guard

**Verified, fresh this session.**

```
$ curl -sI localhost:3000/dashboard
HTTP/1.1 307 Temporary Redirect
location: /login
```

Requesting `/dashboard` signed out redirects to `/login` with a 307, as
expected.

#### Cookie flags (fix-spec F5, part 1 of 2)

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

### Design 10.2 RLS cross-user cases — 5 of 6 verified live

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

### Definition of done walk-through (design section 11)

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

## Past events screen (visual slice)

**Date:** 2026-08-29
**What was compared:** `/events/past` (the real route, `listPastEvents` reading through
`past_events_with_counts` on the live hosted project, signed in as the seeded DJ, Test User A)
against `design/artboards/Spinit Past Events.dc.html`.
**How:** this session had no browser automation tool available (Claude in Chrome was declined for
the session). The user drove the check manually: started the dev server (`npm run dev`, port 3002 —
3000 was in use by another session), signed in, and reported back with a screenshot.

### Desktop (default width)

Matches the artboard: dark sidebar with "Past events" rendering as the current non-link item and
"Dashboard"/"Upcoming events" as links; the search field with the magnifier icon; three month
headings in order (JULY 2026, JUNE 2026, MAY 2026) — the fourth seeded event (Lena & Mark,
cancelled) correctly does not produce a fourth group or row anywhere on the screen, and the fifth
(Maya & Tom, upcoming) correctly does not appear either, since the view filters to
`status = 'completed'`; each row shows the 52px-style date tile (day over weekday), couple name,
venue, song count, and a "View recap" link; the zero-song event (Ruth & Adam) reads "0 songs
played", not 1 — the `count(s.id)` case working correctly through the live view, not just in the
unit test.

**One thing worth recording precisely:** the first screenshot was taken signed in as **Test User
B**, who correctly saw "No past events yet" — an RLS-correct result (B owns none of the seeded
rows) but not useful for comparing against the artboard's populated state. Re-signed in as Test
User A and got the populated screen above. Noted here because it's a real, if accidental,
confirmation that the owner-scoped `select` policy behaves as intended for a user who currently has
zero rows, distinct from the "B sees zero of A's rows" case Task 7's integration suite already
covers directly.

**One known, expected, pre-existing 404, not a defect of this task:** clicking "View recap" 404s.
`/events/[id]/recap` does not exist — recorded in design §11 gap 1 before this task ran (the
dashboard's own `PastEvents.tsx` card already links to the same nonexistent route). Out of scope
for this slice.

### Not tested this round

The ~400px responsive collapse (sidebar to a top strip) and the row-hover behaviour (background
tint, no pink text) were not checked — the user confirmed the desktop view was sufficient evidence
to proceed rather than spending more time on the narrower breakpoint and the hover state. Recorded
as not checked rather than assumed to match; nothing here says they are broken, only that they were
not looked at.

---

## Full verification (Past events, Task 13)

```
$ npm run lint    -> exit 0
$ npm run typecheck -> exit 0
$ npm test        -> 1 failed | 163 passed (164), 18/19 files passed
     The one failure is src/lib/auth/rls.integration.test.ts > "signUp creates a profile row
     with metadata carried through by the trigger" -- AuthApiError, email_address_invalid.
     Confirmed unrelated to this branch: `git diff --stat 2304f27...HEAD -- src/lib/auth/
     src/lib/supabase/` is empty -- this branch changes zero files in that area. Excluding
     that one file: 18 files / 158 tests pass. This is Supabase's hosted GoTrue now rejecting
     @example.com as non-deliverable -- a service-side validation change, different from the
     previously-documented rate-limit issue, and does not self-heal. Belongs to feat/supabase-auth,
     not this branch.
$ npm run build   -> exit 0, Route (app) includes ƒ /events/past
$ npm audit       -> found 0 vulnerabilities
```

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

---

## Task 12 — final manual verification, dashboard-data slice

**Date:** 2026-08-30. Run from the worktree root, tip `2b70bd8`.

### `npm run test` — real counts

```
$ npm run test
 Test Files  2 failed | 20 passed (22)
      Tests  2 failed | 196 passed (198)
```

Two failures, both read in full:

1. `src/lib/auth/rls.integration.test.ts` — `signUp creates a profile row with metadata carried
   through by the trigger`: `AuthApiError` `over_email_send_rate_limit` (429), "email rate limit
   exceeded". This matches the pre-existing, documented mailer cap (Supabase's built-in mailer, 2
   emails/hour project-wide; see this repo's CLAUDE.md). Not a defect, not new. The other 5 of 6
   cases in that file passed live — same result already recorded above under "5 of 6 verified live";
   nothing in this run changes that count or that reasoning.

2. `src/lib/supabase/server.test.ts` — `passes httpOnly, sameSite, and path flags through to
   createServerClient`: fails at module resolution, `Failed to resolve import "server-only" from
   "src/lib/supabase/server.ts"`. **This is new and was not predicted by this task's brief.**
   Diagnosed, not fixed (out of this task's scope — the fix would touch `vitest.config.ts` or
   `node_modules`, neither of which this task is authorized to modify): this worktree's own
   `node_modules/` contains nothing but a `.vite` cache directory (`ls node_modules/` shows only
   `.vite`, no `next` package locally). Vitest's other 196 passing tests work anyway because Node's
   own `require`/import resolution walks up past the worktree to the parent checkout's
   `node_modules` when a package isn't found locally. The `server-only` alias in `vitest.config.ts`,
   however, is written as a literal path relative to the worktree
   (`./node_modules/next/dist/compiled/server-only/empty.js`), which does not exist in this
   worktree, so that one specific resolution fails while everything else silently succeeds via the
   parent checkout. This is an environment/dependency-installation gap in this worktree, not a code
   defect in the dashboard-data slice or in `src/lib/supabase/server.ts` itself. Confirmed stable,
   not a mid-install race: `node_modules/` mtime unchanged across repeated checks.

`src/lib/dashboard/rls.integration.test.ts` (Task 11's suite) was also re-run standalone to confirm
Task 11's result still holds against the live database:

```
$ npx vitest run src/lib/dashboard/rls.integration.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

5/5, no skips — matches Task 11's recorded result exactly. This slice's new dashboard queries,
`listActiveEvents` and `listRecentPastEvents`, have now been verified against a real database via
this suite, not merely against fixtures.

### Preview route (`/design/dashboard`) — could not genuinely verify

`npm run dev` was started in the background. It reported `✓ Ready in 486ms` and bound to port 3003
(port 3000 was already in use by an unrelated process on this machine). However, every request to
the dev server returned HTTP 500, including `/design/dashboard`:

```
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3003/design/dashboard
500
```

The dev server's own log shows why, and it is the same root cause as the `server-only` test failure
above: Turbopack cannot resolve the `next` package from this worktree, because this worktree's
`node_modules/` is effectively empty.

```
Turbopack build encountered 1 error:
./src/app
Error: Could not find the Next.js package (next/package.json)
Resolved from: .../dashboard-data/src/app
```

Unlike Vitest (via Node resolution) or `npm run typecheck`/`npm run build` in the last recorded run
against a different tip, Turbopack does not walk up to a parent checkout's `node_modules`, so this
failure is total: no route in this worktree can currently be served by `next dev`, not just the
preview route. I did not fabricate a visual check — I have no way to load a browser against this
worktree's dev server right now, and the dev server itself does not render anything to look at. What
I did verify for real: the dev process starts without a startup-time crash, binds to a port, and logs
`Ready`; and that every HTTP request against it 500s for the reason quoted above, which is an
environment/dependency-installation gap in this worktree, not a defect in `DashboardScreen`, the
`demoData` fixture, or the preview route's own code. This is out of this task's scope to fix (would
require `npm install` or a `next.config.ts` change, neither named in this task's brief) and is
reported here for a human to decide on, not silently worked around.

As a substitute check within scope, I read the component wiring rather than claiming a rendered
check: the design-preview route (`src/app/design/dashboard/page.tsx` per Task 8/10's prior work)
renders `DashboardScreen` from the static `demoData` fixture, and `DashboardScreen.test.tsx` (the only
test file covering `DashboardScreen`/`DashboardSidebar` — `DashboardSidebar` has no test file of its
own) already carries 14 passing unit/RTL tests covering the sign-out control and layout wiring at the
component level. That is a code-level check, not a rendered-page check, and I am stating the
distinction rather than blurring it.

### Summary

- Unit + RTL suite: 196 of 198 tests passed across 22 test files (20 files fully green, 2 files with
  one failure each). Both failures diagnosed above; neither is a defect in the dashboard-data slice.
- `src/lib/dashboard/rls.integration.test.ts` (Task 11): 5/5 passed live against the real database,
  no skips — re-confirmed in this session, unchanged from Task 11's own result.
- `src/lib/auth/rls.integration.test.ts`: 5/6 passed live; the sixth is the documented mailer
  rate-limit case, unchanged from the pre-existing record above.
- Preview route: **not genuinely verified visually** in this session — the dev server 500s on every
  route in this worktree due to a `node_modules` gap unrelated to this slice's code. Verified instead,
  and only, that the dev process starts and that the 500 traces to Turbopack's module resolution, plus
  the existing component-level test coverage for the same UI.
- `listActiveEvents` and `listRecentPastEvents` (this slice's dashboard queries) are now verified
  against a real, live Supabase database, not merely against fixtures, via Task 11's suite re-run
  above.

## Correction, 2026-08-30 — the node_modules gap above is fixed, and both flagged items are now real

The "could not genuinely verify" items above were an environment gap, not a code defect: this
worktree's `node_modules/` had never been populated (`npm install` was never run in it — confirmed by
comparing against the other worktrees in this repo, `dj-dashboard` and `past-events`, which both have
a full `node_modules/next`). Fixed by running `npm install` in this worktree (458 packages added, 0
vulnerabilities). Both checks were then re-run for real:

- **`npm run test`, re-run after the install:** `Test Files 1 failed | 21 passed (22)`, `Tests 1 failed
  | 197 passed (198)`. The `server.test.ts` failure recorded above is gone — it was the same
  `node_modules` gap. The one remaining failure is the same, already-documented mailer rate limit
  (`AuthApiError`, `over_email_send_rate_limit`, 429) on `src/lib/auth/rls.integration.test.ts`'s
  `signUp` case — environmental, not a defect, not part of this slice.
- **Preview route, actually loaded:** `npm run dev` (port 3001, `next dev` / Turbopack, no `next.config.ts`
  or install changes needed beyond the `npm install` above) then `curl http://localhost:3001/design/dashboard`
  → `HTTP 200`. The response body contains `Jordan Ellis`, `Ellis Sound`, and `8:00 PM` (the live banner,
  rendered from `demoData`'s `startedAt`), and does **not** contain "Sign out" — correct per Task 8/10's
  own spec, since the preview route passes no `signOutAction` and a design preview has no session to
  end. Dev server stopped after the check.

Net result: every item Task 12 flagged as unverified is now verified, and nothing found in doing so
contradicts anything recorded above. The dashboard-data slice (Tasks 1-12) is fully implemented, fully
tested (197/198 real test results, the one gap being a documented external rate limit), and its
preview route confirmed rendering correctly.

## Empty-states manual check (fix-spec F4), performed 2026-08-30

Plan Task 12 Step 2 required editing the preview route temporarily to pass empty `upcoming`/`past`
arrays and confirm both empty-state messages render, then reverting the edit. This was never actually
done when Task 12 was originally executed — it was silently skipped, not recorded as skipped. Performed
for real now, separately from that original session.

**What was checked:** `src/app/design/dashboard/page.tsx` was temporarily changed so `DashboardScreen`
received `data={{ ...demoData, upcoming: [], past: [] }}` (keeping `dj`, `now`, and `liveEvent` from
`demoData` as-is). `npm run dev` was started (bound to port 3001; port 3000 was already in use by
another process), then:

```
curl -s http://localhost:3001/design/dashboard | grep -o "No upcoming events yet\.\|No past events yet\."
```

Actual output:
```
No upcoming events yet.
No past events yet.
No upcoming events yet.
No past events yet.
```

Both empty-state messages are present (each appears twice — once in the rendered HTML, once in the
RSC flight payload embedded in the same response; not a defect). The dev server was then stopped and
confirmed stopped (`pgrep -fl "next dev"` returned nothing). The temporary edit to
`src/app/design/dashboard/page.tsx` was reverted; `git diff src/app/design/dashboard/page.tsx` showed
no output, confirming an exact revert.

## A note on why `npm run test`'s pass count is not a stable number, 2026-08-30

Every full run of the suite executes `src/lib/auth/rls.integration.test.ts`'s `signUp` case against
the live Supabase project. That project's built-in mailer is capped at 2 emails/hour, shared across
signup and recovery, **project-wide, not per-user**. Each full run spends part of that budget; once
it's exhausted, the `signUp` call itself 429s (`AuthApiError`, `over_email_send_rate_limit`), and that
failure can cascade into whatever assertions in that same test file run after it. Four consecutive runs
during this branch's own verification read 197/198, 196/198 (2 files failing), 199/200, and 200/200 at
different points — not because anything regressed between them, but because of this budget.

**If you re-run this suite and see a different failure count than the ones recorded above in this
file, that is expected** and does not by itself mean something broke. Check the failure's own error
text before concluding a regression: `over_email_send_rate_limit` (429) is the mailer cap, not an app
or RLS defect. A failure with a different message is worth investigating; this one is not.

Corroborated independently: a second session ran the full suite four times in roughly ten minutes,
from the same clean tree at the same commit, and read 197, 196, and 199 passing (out of 198-200
depending on which run) at different points in that window — same mechanism, same conclusion.

## Event page (/events/[id]) — design 2026-08-30

Recorded 2026-08-30. Plan: `docs/specs/2026-08-30-event-detail-plan.md`, task 15.

Driven with a throwaway Playwright script (`npm install --no-save playwright`, deleted
afterward) against a real `next dev` server bound to port 3000, confirmed by process `cwd`
to be this exact worktree/branch (`feat/event-detail`) — a second `next dev` instance found
running on port 3001 turned out to belong to a *different* worktree
(`.claude/worktrees/feat+event-recap`) and was not used. `chromium-cli` / the Claude-in-Chrome
extension were not available in this session, hence the scripted approach. Logged in as the
seeded demo DJ (`SEED_DJ_EMAIL`/`SEED_DJ_PASSWORD` from `.env.local`) and exercised the real
`/events/[id]` route end to end — no mocks, no stubbed data.

An early pass of the script had a selector bug (`nth()` indexing collided across the
ceremony/reception/party inputs) that clicked the wrong "Add" button and left stray text in
the ceremony "Breaking the glass" field. This was a bug in the *test script*, not the app —
confirmed by screenshot and fixed by scoping locators to each section's `<section>` container
and by each field's accessible label instead of guessing index positions. `npm run seed:demo`
was re-run afterward to restore Priya & Alex's seeded ceremony data (idempotent upsert by
derived id), and Maya & Tom's `notes` column (touched by check 6 below, which the seed script
doesn't reset since that fixture's `notes` is `null`) was cleared back to `null` directly.

1. **Page renders names/step-trail/streaming/ceremony/lists/notes.** Verified. Opened
   `/events/01fda947-...` (Priya & Alex) as the DJ. The rendered page shows "Priya & Alex",
   all three step pips filled (Details/Invite/Streaming), the "Coming soon" streaming
   placeholder (see note below on the intentional deviation here), both ceremony slots
   pre-filled ("A Thousand Years" / "Hava Nagila"), one reception must-play ("Can't Help
   Falling in Love"), one party must-play ("September"), two party do-not-play entries
   ("Nickelback", "Cha Cha Slide"), and the note about the surprise speech. Cross-checked
   directly against the database with `supabase db query --linked` on `event_must_play` and
   `event_blocklist` for that event id — the four must-play rows and two blocklist rows
   returned by that read-only query match the page byte-for-byte (same titles, artists,
   moments, entry types). This is live data through the real DAL, not mock data.

2. **Side-by-side against the New Event artboard.** Verified by reading the artboard's
   source (`Spinit New Event.dc.html`, via `DesignSync.get_file`) alongside a full-page
   screenshot of the running app, rather than a pixel-diff tool. Structure matches: 640px
   card, 24px radius, 36px padding; 26px step pips; the ceremony slot layout (label above a
   1.4:1 title/artist row); must-play chips (rounded pale panel, title — artist, moment
   line, × remove); do-not-play chips (uppercase red type pill + value); the add-row field
   proportions and the pink accent buttons; the notes textarea; the bottom bar with
   "← Back" / "Saved ✓" / primary button. Two **intentional, already-documented** deviations
   from the artboard, not defects: (a) the streaming/taste-analysis block shows honest
   "coming soon" copy instead of the artboard's fixture 84%-match numbers, since no streaming
   integration exists yet (`StreamingSection.tsx`, design §7.2 scope); (b) "← Back" always
   returns to `/dashboard` rather than the artboard's step-2, since steps 1–2 (create/invite)
   are out of scope for this page (`EventDetailsForm.tsx`, design §4).

3. **Add then remove a party must-play, no manual reload.** Verified. Added "Smoke Test
   Song" to the Party must-play list; it appeared in the list within ~1s with no page
   navigation. Clicked its × remove button; it disappeared, again with no reload. Confirms
   `revalidatePath` is being given the literal `/events/<id>` path rather than the `[id]`
   pattern (the failure mode the plan calls out explicitly).

4. **Duplicate do-not-play entry, different case.** Verified. Added "NICKELBACK" to the
   Party do-not-play list, which already had "Nickelback". Got the exact message "Already on
   the do-not-play list." — confirms the `lower(value)` unique index and the 23505→friendly-
   message mapping in `addBlocklistEntry`.

5. **Clear a ceremony slot and save.** Verified. Cleared the "Breaking the glass" title
   (leaving "Walking down the aisle" untouched) and pressed "Save changes". Saw "Saved ✓".
   Reloaded the page: the cleared slot came back empty, and the untouched slot still read "A
   Thousand Years" — confirms per-slot id-keyed writes don't clobber siblings.

6. **Notes-only save on a slot-less event.** Verified, using "Maya & Tom" (seeded with no
   must-play/blocklist rows). Typed a note with nothing else filled in and saved: got "Saved
   ✓", and the note was still there after a reload. Confirms the ceremony schema's "blank
   title is legal" rule doesn't block an otherwise-valid notes-only submission. (Test note
   was cleared back to `null` afterward, see above.)

7. **With JavaScript disabled.** Verified, using a second browser context that reused the
   authenticated session's cookies but had `javaScriptEnabled: false` (Playwright's
   equivalent of DevTools → Disable JavaScript). Added a party must-play row ("NoJS Song")
   and removed it again — both worked via real full-page form posts, confirming the actions
   are reachable without client JS. Also confirmed the notes textarea's value was byte-for-
   byte unchanged before and after those two form submissions — the check that would catch
   the details form wrapping the list sections (nested `<form>`s silently dropped by the
   parser, turning every add/remove into a save-notes submit). It didn't happen: the sibling-
   form structure from task 11 holds under real no-JS form posts, not just under jsdom.

8. **Unknown event id → 404.** Verified. `/events/00000000-0000-0000-0000-000000000000`
   returned a real HTTP 404 (checked the response status, not just page text) and rendered
   the app's not-found page.

9. **Another DJ's event id → the same 404, not 403.** Verified. Logged in as `TEST_USER_B`
   (a second Supabase user configured for the RLS integration tests) in a separate browser
   context and requested Priya & Alex's event id, which belongs to the seed DJ, not
   `TEST_USER_B`. Got HTTP 404 — the same response as check 8, not a 403 — confirming the
   route doesn't leak whether an id exists to a DJ who doesn't own it.

**Result: all nine checks passed.** No app defects found. The only issues encountered were in
the throwaway test script itself (selector ambiguity), not in the product, and were fixed
before drawing conclusions rather than worked around.
