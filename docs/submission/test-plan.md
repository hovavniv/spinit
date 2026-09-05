# Test plan

Deliverable 5. What is tested, how, and — the part that matters more — what makes a test
here worth trusting.

Companion documents: `manual-tests.md` records every manual check actually performed, with
dates and results. The test code itself is deliverable 6.

---

## 1. The principle this project settled on

> **An assertion nobody has seen fail is a comment.**

That is not a slogan. It came from finding, twice, that a passing test was pinning nothing.

- `EventDetailScreen.test.tsx` asserted that the details form was not a wrapper around the
  other forms. `EventDetailsForm` takes no children and renders a link, two spans and a
  button — so it *cannot* contain a nested form, and the assertion could not fail. A
  reviewer wrapped the entire card in an outer `<form>`, which is exactly the defect the
  test existed to prevent, and all five assertions still passed.
- A component fixture set `privateNotes: ''` **and** `sharedNotes: ''`. With two identical
  empty values, nothing distinguished the fields. A reviewer piped the DJ's private note
  into the box a partner can read and overwrite, and every component test passed.

So every strengthened assertion in this project is **proven by mutation**: introduce the
bug, watch the named test fail, revert. Two rules follow, and both are enforced in the
plans rather than left as advice:

**Distinct fixture values per field, always.** Two fields holding the same value cannot
detect being swapped.

**Fixtures reset to a known state; they never assume one.** The partner RLS suite passed
standalone and failed under `npm test`, because a manual walk had left a slot claimed;
`beforeAll` assumed unclaimed, failed, and `afterAll` then *restored* the row so the next
run passed. A suite that passes every other time is worse than one that fails honestly.

---

## 2. What is tested, by layer

| Layer | Tool | What it can prove | What it cannot |
|---|---|---|---|
| Pure units | Vitest | business logic, formatting, validation | that anything is wired together |
| Components | Vitest + RTL, jsdom | rendering, interaction, prop wiring | real network, real RLS |
| Server actions | Vitest, mocked Supabase | ordering, error mapping, what gets written | that the write is permitted |
| **RLS integration** | Vitest against the **live project** | who can reach what | UI behaviour |
| Migrations | `npm run db:replica` | that SQL parses, applies in order, and produces the grants and policies it claims | anything about PostgREST |
| Manual | documented walkthroughs | that it works for a person | regressions, repeatably |

115 test files as of `feat/live-event`, 1146+ tests, before merge. `src/lib/events/
rls.integration.test.ts` and `src/lib/auth/rls.integration.test.ts` are the flakiest files in
the repo for reasons that have nothing to do with correctness — a clock-skew `JWT issued at
future` against Supabase's auth server, or a bare network blip — and the fix, verified
repeatedly, is to re-run the whole file rather than investigate; a failure there with the rest
of the suite green is the flake, not a regression.

**A historical example, kept because the lesson generalises.** An earlier slice's `signUp`
test failed with `429 over_email_send_rate_limit` — Supabase's real, project-wide
2-emails-per-hour cap — and that explanation was reported for a day. The same test then
produced a **different** error, `Email address "…@example.com" is invalid`: not a quota, a
**validation rejection**, because the test generated addresses at `example.com`, the RFC 2606
reserved domain, which Supabase's validator rejects outright under some configurations. Two
distinct failures had been wearing one label, and **a failure with a plausible explanation
stops being investigated** — the second cause was found only because someone noticed the
*error text had changed* rather than re-reporting the first label.

**Resolved, not just diagnosed**: the domain moved to `@gmail.com` (still never a real send —
Supabase never delivers to it, it just satisfies the validator), and both `signUp` tests in
`auth.integration.test.ts` are now opt-in behind `RUN_MAILER_TESTS=1` rather than running on
every gate, so the quota is never spent by accident. `npm run gate` is green at exit 0 with no
env var set.

---

## 3. Core features

### 3.1 Authentication

- Registration validates before submitting; a weak or mismatched password never reaches the network.
- Login failure returns one generic message whether the email is unknown or the password wrong.
- The auth callback exchanges a code for a session and redirects.
- `siteUrl()` never reads a request header, so a forged `Host` cannot influence a redirect.
- Errors map to generic strings; no provider text, internal URL or submitted input escapes.

Files: `lib/auth/actions.test.ts`, `errors.test.ts`, `redirects.test.ts`,
`app/auth/callback/route.test.ts`, `components/auth/*.test.tsx`.

### 3.2 The dashboard and past events

- Upcoming and past events split by status and date, with a stable order.
- Counts come from the view, not N+1 queries.
- Empty states render as themselves rather than as a blank list.
- Relative dates ("in 9 days") are computed against an injected clock, never `Date.now()` —
  a test that depends on the real clock fails on one specific day of the year.

Files: `lib/dashboard/*.test.ts`, `lib/events/pastEvents.test.ts`,
`components/dashboard/DashboardScreen.test.tsx`.

### 3.3 The event page

- Ceremony slots, must-play and do-not-play render per segment.
- Each add and each remove is one write; the screen reflects it without a full save.
- Private notes render for the DJ and not for a partner; shared notes for both.
- The note forms are **siblings** of the details form, not nested inside it.

Files: `components/events/detail/*.test.tsx`, `lib/events/detailActions.test.ts`,
`detailDal.test.ts`, `notesActions.test.ts`, `segments.test.ts`, `viewer.test.ts`.

### 3.4 The recap

Every song in order, with attribution, and a stable sort under tied timestamps.

Files: `lib/events/recap.test.ts`, `components/events/FinalPlaylist.test.tsx`.

### 3.5 The ranking engine — every one of its seven terms, pinned by mutation

`rankQueue` is this project's differentiating piece (`technical-design.md` §7), so its tests
get the highest bar in the project: **each of the seven ranking terms — the do-not-play
match, unplayed must-plays, requester count, phase fit, minutes left in phase, the
artist-repeat limit, and genre-pending — was proven with a real mutation**, not asserted.
The procedure, every time: edit the real function to remove or invert the term, confirm the
NAMED test goes red, restore, confirm green again. One term (phase-fit) had no test in the
original brief at all — the implementer building it added a 13th test on its own initiative
before reporting done, rather than shipping a term the mutation discipline could not have
caught missing.

`reasons.ts` (the plain-English rendering of a ranked row's `Reason[]`) is tested separately
from the scoring itself, so a wording change can never accidentally mask a scoring regression
or vice versa.

Files: `lib/live/rank.test.ts`, `lib/live/reasons.test.ts`, `lib/live/phaseClock.test.ts`.

### 3.6 The live screen and the guest flow

- Starting an event mints its join token exactly once (the `status = 'upcoming'` guard makes
  the transition single-shot, so a token already on a printed QR code cannot be rotated out
  from under it) and requires a phase.
- The phase picker is a `radiogroup`; changing phase reverts optimistically on a failed write
  rather than showing a phase that never committed.
- Play and Skip are idempotent under the advisory lock described in `technical-design.md` §5:
  two concurrent Plays cannot collide on `position`, and a second Play on an already-played
  suggestion returns "already played" rather than inserting a duplicate row.
- The poll route (`/api/live/[id]/state`) resolves up to 10 unresolved tracks per cycle and
  patches the in-flight response so the DJ never waits a full extra 8-second cycle to see a
  track that resolved just now; a failed poll keeps the last good render rather than blanking
  the screen.
- The guest's picker enforces the ≤3-suggestion cap and the one-vote-per-guest-per-song rule
  at the COMPONENT level (immediate UI feedback) and, separately and non-negotiably, at the
  DATABASE level (§5.4) — the component test proves the UI does not let a guest try the
  disallowed action; the integration test proves the guard holds even if the UI is bypassed
  entirely, which is the only one of the two an attacker cannot route around.
- The QR modal's Copy-link falls back to text selection when `navigator.clipboard` is
  unavailable (a non-secure-context dev server), and never generates a QR for a `join_token`
  known to be null (§9 of `technical-design.md`).

Files: `components/live/*.test.tsx`, `lib/live/liveActions.test.ts`, `liveDal.test.ts`,
`readActivity.test.ts`, `guestActions.test.ts`, `guestDal.test.ts`, `guestErrors.test.ts`,
`qr.test.ts`, `components/guest/*.test.tsx`, `app/join/[token]/*.test.ts(x)`,
`app/events/[id]/live/page.test.tsx`, `app/api/live/[id]/state/route.test.ts`.

---

## 4. Invalid input

Every schema is tested from **both** sides — the value that should pass and the value one
step outside it. A schema tested only with valid input proves nothing.

| Input | Rejected |
|---|---|
| Email | malformed, empty, over-length |
| Password | under 8 characters, mismatched confirmation |
| Phone | anything outside `PHONE_PATTERN` |
| Venue, couple names | empty, and one character over the check constraint |
| Notes | 2001 characters — the constraint's number, one over |
| Event id | any non-UUID, before it reaches Postgres |
| Spotify id (Plan B) | 21 characters, 23 characters, non-alphanumeric |
| Search query | under 2 characters, over 100 |
| Join token (route param) | any string not matching `^[A-Za-z0-9]{22}$` — `notFound()` before it is ever used to build a cookie name or reach the database |
| Guest display name | blank, all-whitespace (tab/newline/CR, not just space — §5.4), 41 characters |
| Guest suggestion title/artist | over 200 characters after trimming |
| Guest track id | any string not matching `^[A-Za-z0-9]{22}$` |

The length limits deliberately duplicate the database's `check` constraints. Zod gives the
user a field error; the constraint is the actual control, because any authenticated user can
`PATCH` PostgREST directly and skip the form entirely — and for the guest boundary, the
`security definer` function's own guard is the ONLY control, since `anon` never reaches a
`check` constraint through a table grant it doesn't have.

**One fixture-shape lesson from this slice, worth stating as a rule rather than a story.** A
test named "a blank name is rejected" whose fixture is 41 spaces is invalid in **two**
respects at once — blank AND too long — so it cannot tell you which guard actually caught it,
and deleting either one leaves the test green. Every invalid-input test here is invalid in
**exactly one** respect; a fixture that needs an "and" to describe what's wrong with it is two
tests, not one.

---

## 5. Permissions, per role

**This is the most important section, and it is tested against the live project rather
than a mock**, because a mock of RLS tests the mock.

Three files, three accounts: user A (DJ), user B (a second DJ), user C (a partner).

### 5.1 What is asserted

| Assertion | Why it exists |
|---|---|
| A second DJ reads none of A's events, song lists, notes or recap | the original ownership boundary |
| A partner reads the event they are linked to | the widened boundary works |
| A partner of event A cannot read event B | the link is **per event**, not per DJ — A owns two events and C claims a slot on one |
| A partner cannot set `status = 'cancelled'` | only SELECT widened; writes stayed DJ-only |
| A partner cannot read `event_private_notes` | the notes split holds |
| A partner can read and write `event_shared_notes` | the other half of the split |
| A partner can add and remove song-list rows | the couple can edit their own lists |
| **A DJ cannot `PATCH` `event_partners.user_id`** | the column grant, not a policy |
| **A DJ cannot `POST` an `event_partners` row with an explicit `user_id`** | the adjacent verb |
| `claim_partner_slot` refuses an uninvited caller with `42501` | email-matched linkage |
| `claim_partner_slot` refuses an already-claimed slot with the same code | failures are indistinguishable |
| Two concurrent claims produce exactly one winner | the row lock |
| Deleting a partner's account purges their token, connection and profile | the trigger |
| Neither the DJ nor the other partner can read `spotify_tokens` | owner-only |
| `anon` holds no grant on any table | the hosted default ACL was revoked |
| A partner reads ALL of their linked event's `played_songs`; the same partner reads ZERO of a different event's, despite it having real rows | the SELECT widening (§5.4) is scoped correctly in both directions, against non-empty fixtures on both sides |
| A partner cannot insert, update or delete a `played_songs` row of the event they ARE linked to | only SELECT was widened — three separate assertions, not one, because a `for all` policy would pass a read-only test |

### 5.2 Why the last two rows of that table are one test, not two

Three consecutive reviews found the same defect: a control closed on one surface and left
open on the adjacent one. `UPDATE` was column-scoped while `INSERT` stayed table-level. A
table write-grant was removed while the equivalent RPC stayed granted.

**Each time, the fix was correct and the test pinned only the case already found.**

So assertions here are written **per capability, not per verb**:

> No `authenticated` path writes the artist cache — enumerated from **both**
> `information_schema.role_table_grants` **and** `information_schema.role_routine_grants`.

One assertion, both surfaces. It would have caught the defect that two verb-shaped
assertions missed. Splitting it "for clarity" is how one gets fixed and the other does not.

### 5.3 Two things about running these

Every client after the first is created with `{ auth: { persistSession: false } }`.
`createClient` derives its storage key from the project ref alone, so under the global jsdom
environment two clients share one `localStorage` slot and the second sign-in silently
overwrites the first. This produced real false results before it was diagnosed.

**A green result that cannot be explained is not evidence.** Two early runs of this suite
passed for the wrong reasons: one "refused" outcome was actually the event id resolving to
`NULL`, because RLS correctly hid the row from a user who was not yet a partner — the test
was reading its own fixture through the policy it was testing. Both were test bugs. They
were caught by refusing to accept a pass that had no explanation.

### 5.4 The guest boundary — `src/lib/live/guest.integration.test.ts`

**This is the file where every RLS/grant claim about the guest boundary stops being
shape-checked and becomes verified.** A scratch-Postgres replica (§6) can prove a `CHECK`
compiles and a policy can be created; its stub `auth.uid()` always returns null, so it can
prove no RLS *behaviour* at all. This file runs against the live project with real Postgres
and real PostgREST, which is what caught the ambiguous-embed defect (`technical-design.md`
§6) that the replica structurally cannot see.

| Assertion | Why it exists |
|---|---|
| `anon` cannot `select` or `insert` on any of the five guest tables | table grants are the first layer; a missing revoke here is the most damaging possible mistake |
| The six guest functions ARE callable by `anon`; `dj_play_suggestion`/`dj_play_pick` are NOT | a **different** claim from the row above — a function left `PUBLIC`-executable would pass the table-grant test with a clean sheet, because it never touches a table grant at all |
| `guest_join` on a live event succeeds; on a non-live event, `event_not_live`; with a wrong token, `no_such_event` | the token is inert unless the event is live, and the two failures are deliberately distinguishable (`security.md` §8.2's `guest_event`) |
| A blank (all-whitespace, not just space) name is rejected `bad_display_name`; a 41-character name is rejected `bad_display_name` — as two separate tests | one fixture invalid in two respects pins neither guard |
| A fourth suggestion from one session raises `suggestion_limit` | the ≤3 cap, under the advisory lock that makes it a real check-then-insert-proof serialization, not a race |
| Suggesting an already-suggested track returns `was_existing: true`, adds a vote, and does **not** increase the suggester's own `used_count` | the dedupe-into-a-vote path proven through the real RPC boundary, not only at the SQL level |
| Voting twice from one session leaves exactly one vote row | `primary key (suggestion_id, guest_id)` |
| Voting on a suggestion from a **different** event is rejected `wrong_event` | a uuid being unguessable is not an authorization control |
| `guest_queue`'s `used_count` still counts a suggestion after it moves to `skipped` | a played/skipped suggestion still occupied a cap slot, even though it drops out of the *pending* rows returned |
| `guest_search_allow` returns `true` for 60 calls and `false` on the 61st | the shared, cross-tenant Spotify app token's real ceiling |

**Two real, previously-invisible defects were found by writing and running this file, not by
reviewing the migration text.** `song_suggestions`' embed of `guest_sessions` was ambiguous
(`PGRST201`) against real PostgREST regardless of row count — fixed with an explicit FK
qualifier. And three of this file's own status-flip-then-restore fixtures checked only
`restore.error`, not the affected-row count; a zero-rows-matched `UPDATE` returns `error:
null` from PostgREST, so a silent no-op restore would have left a **shared, live** fixture
event stuck in the wrong state for every later run, with nothing failing loudly at the moment
of the actual defect. Both fixed before merge — the second one is exactly the class of
mistake §5.3's "a green result that cannot be explained is not evidence" already names, one
layer further down.

**One fixture choice worth recording as a decision, not a detail.** The `played_songs`
partner-widening tests (§5.1) use two events that both have real, non-empty `played_songs`
rows for the positive AND negative case — not the sibling suite's own partner fixture event,
which has zero. An empty table makes "the partner reads zero rows" true whether or not the
policy admits them at all; a table with real rows on both sides is an actual proof in both
directions.

---

## 6. The database

Migrations are tested by **running them**, not by reading them.

`npm run db:replica` creates a scratch database, stubs the Supabase surface the migrations
reference (`auth.users`, `auth.uid()`, `extensions.moddatetime`, the three roles), applies
every migration in order under `ON_ERROR_STOP=1`, and drops it on any exit.

Two design decisions in that script are themselves lessons:

**`--seed` inserts as soon as `public.events` exists, mid-run.** Seeding after all
migrations would have meant every per-event backfill processed **zero rows and looked
fine** — the silent-zero-row failure, in the test tool.

**The stub reproduces the hosted default ACL** (`grant truncate, references, trigger` to all
three roles). Without it, a *missing* revoke passes unnoticed locally. A replica that cannot
fail for the reasons production would is worse than none, because it manufactures confidence.

It also has a limit worth stating: it proves a migration parses, applies in order and
produces the grants, policies and constraints it claims. It proves **nothing** about
PostgREST's behaviour, and its stub `auth.uid()` always returns null, so it proves nothing
about RLS *behaviour* either — only that a policy can be created and a `CHECK` compiles and
refuses the rows it should.

**Two real defects this replica caught, both proven by running SQL rather than reading it.**
A `CHECK` constraint written as `not exists (select 1 from unnest(arr) ...)` failed to compile
at all — Postgres CHECK constraints cannot contain a subquery — which four separate prose
reviews of the design missed and eleven seconds of `psql` did not. And `max(position) + 1`
inside a `security invoker` function returns `NULL` on an event's first song (`max()` over
zero rows is `NULL`), which would have failed the very first Play of every wedding.

The six guest-facing functions were additionally, genuinely proven **as `anon`** in this same
harness — `set role anon`, then call each of the six (all succeed) and each of the two
DJ-only play functions (both refused) — because they take a session id as an explicit
argument and never call `auth.uid()`, the one class of function this replica's stub cannot
defeat.

Every migration is additionally verified **against the live project after the push**, with
`supabase db query --linked`, reading the output rather than trusting the push command —
including, for the guest functions, comparing `pg_get_functiondef()` against the exact
committed source, not just confirming the function exists.

---

## 7. Edge cases

- **Tied timestamps.** `now()` is transaction start time, so a multi-row insert gives every
  row an identical `created_at`. Ordered reads add the primary key as a tiebreaker;
  otherwise PostgREST returns tied rows in whatever order the executor picks.
- **One-to-one versus one-to-many embeds.** PostgREST returns a to-one embed as a JSON
  **object** and a to-many as an array. Indexing `[0]` into the object yields `undefined`,
  the field renders empty, and the next save writes `''` over real data — a destroy, not a
  blank field. `detailDal.test.ts` pins **both** shapes so the code is correct either way.
- **A policy that admits no rows returns success.** So does an `UPDATE` against a row that
  does not exist. Writes upsert; backfills cover every row; tests assert affected-row counts
  rather than the absence of an error.
- **Rate limits as normal operation.** A Spotify 429 is an operating condition, not an
  exception; the search client retries once and then returns a typed error the UI renders as
  "busy".
- **Empty and sparse data.** All three Spotify time ranges empty is a real outcome for a
  light listener and renders as "not enough history", never as "no taste".
- **An ambiguous PostgREST embed is a schema-shape defect, not a data-shape one.** Adding a
  table (`suggestion_votes`) that FKs to two already-related tables (`song_suggestions` and
  `guest_sessions`) creates a second, implicit path between them, and PostgREST refuses to
  choose — `PGRST201`, regardless of row count. No mocked test and no replica-only harness
  (this one included) can see it, since neither runs PostgREST's own relationship resolver;
  only a real HTTP call against the live database does. General form recorded here because
  the next new junction table in this schema will reproduce it exactly.
- **A restore step's own success is not self-evident.** An `UPDATE().eq('id', x)` with no
  `.select()` returns `error: null` whether it matched one row or zero. A cleanup/restore
  step in a fixture or `afterAll` block that checks only `.error` can silently leave shared,
  live state corrupted while reporting success — checking the affected-row count is what
  actually proves the restore happened.

---

## 8. Basic UI

Component tests assert behaviour, not appearance — no snapshots. A snapshot test of a
CSS-module component fails on every style change and passes on every logic change, which is
the wrong way round.

What is asserted: that the right control renders for the right role; that a form submits
what it displays; that an empty list renders its empty state; that an error message appears
without leaking detail; and that forms are siblings rather than nested.

Visual fidelity to the design canvas is verified **manually** and recorded in
`manual-tests.md`, at desktop and at ~400px. Deliberate divergences from the artboards are
recorded there with their reasons rather than silently absorbed.

---

## 9. What is not tested, and why

Stated plainly rather than implied.

1. **No end-to-end browser tests.** No Playwright. The flows are covered by component tests,
   the guest boundary's every guard by a live RLS/RPC integration suite (§5.4), and one real
   documented manual walk (`manual-tests.md`) — but no automated run ever drives a real
   browser through a real QR scan to a real submitted song. That gap matters most for the
   guest flow specifically, since it will have the most users and the least supervision of
   anything in the product, and it is the first thing I would add with more time.
2. **No load testing.** Every number in the scale document is reasoned from documented
   limits and measured API behaviour. None is measured under load.
3. **The RLS suite is not reproducible from the repo alone.** It needs three accounts
   registered by hand through the app's own `/register` form against the hosted project,
   which couples the suite to the register flow — a signup regression breaks the RLS tests
   too, and that coupling is exactly what let one test fail for two different reasons under
   one label. A local `supabase start` stack seeded from a migration would fix both.
4. **Spotify itself is mocked in unit tests.** Real API behaviour is verified by documented
   manual probes — which is how three assumptions in the design were found to be false,
   including that the batch `GET /tracks?ids=` endpoint 403s for this app's credentials while
   the singular endpoint and search both work, discovered by a real call after the design
   assumed the batch endpoint from vendor documentation alone.
5. **The QR code's own visual correctness is not automatically tested.** `qr.test.ts` proves
   the `qrcode` library produces a real SVG string for a real URL — it does not verify the
   code scans correctly on a real phone. That is a manual check (`manual-tests.md`, Task 26's
   walk), because nothing in this stack can decode a QR image without adding a scanning
   dependency for one assertion.
6. **The print stylesheet's physical output is not automated.** The `@media print` block's 2×4
   grid on A4 is verified by an actual print preview during the manual walk, not by a
   headless-browser print-to-PDF check — the paper size and margins are the browser's
   business, and a test asserting on generated PDF bytes would be brittle against exactly the
   things this design deliberately left to the browser.
7. **`PHASE_MINUTES`' four numbers (60/75/120/20) are not tested as "correct".** They are a
   stated default (`technical-design.md` §7), not a computation — there is nothing to prove
   about a policy choice beyond that the code reads the constant it says it reads, which the
   ranking engine's own phase-fit tests already cover incidentally.
8. **The unbounded session-minting gap (`security.md` §8.5) has no test, because there is
   nothing built to test.** A per-event session ceiling is named as the honest fix and is not
   built; a test would need to assert the absence of a limit, which is not a meaningful
   assertion to write.

---

## 10. How a reader can check any of this

```bash
npm test                    # the full suite
npm run typecheck           # next typegen && tsc --noEmit
npm run lint
npm run db:replica          # apply every migration to a scratch database
npm run db:replica -- --seed
```

The RLS integration files additionally need `.env.local` with `TEST_USER_A_*`,
`TEST_USER_B_*` and `TEST_USER_C_*` set, and the three accounts registered — see the README.
Without them those files fail on credentials, which is a setup problem and not a defect.

`src/lib/live/guest.integration.test.ts` additionally needs `npm run seed:demo` to have been
run at least once against the linked project — it reads the seeded `Sara & Daniel` (live),
`Claire & Ben` and `Noa & Eitan` (both completed, both with real `played_songs` rows) events
by name. **Do not run the full test suite immediately before a manual walk** — the
integration suites reset and re-parent `event_partners` rows, which cascades and deletes any
manually-connected guest sessions and Spotify state for the same event. `manual-tests.md`
records this as a sequencing rule: the last `npm run gate` comes before the walk, never after.
The `signUp` tests are opt-in (`RUN_MAILER_TESTS=1`) and spend the project's real 2-emails/hour
mailer quota when run — leave the variable unset for an ordinary gate.
