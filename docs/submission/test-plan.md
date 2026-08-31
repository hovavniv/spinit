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

46 test files as of slice B's merge, growing as the Spotify work lands. One test in
`auth/rls.integration.test.ts` fails, and **the reason took a day to establish properly** —
which is itself the most useful thing in this section.

The first explanation fit: `signUp` was hitting Supabase's project-wide
**2-emails-per-hour** cap, returning `429 over_email_send_rate_limit`. That is real, it is
infrastructure rather than code, and it was reported that way for a day.

Then the same test produced a **different** error: `Email address "…@example.com" is
invalid`. That is not a quota — it is a **validation rejection**. The test generates
`spinit-rls-test+<timestamp>-<uuid>@example.com`, and `example.com` is the RFC 2606 reserved
domain, which Supabase's email validation rejects outright under some configurations.

So there are **two distinct failures wearing one label**:

| Symptom | Cause | Ours? |
|---|---|---|
| `429 over_email_send_rate_limit` | project-wide mailer quota | no — infrastructure |
| `Email address "…" is invalid` | the test uses a reserved domain | **yes — a test defect** |

The lesson is the one worth carrying: **a failure that has a plausible explanation stops
being investigated.** "Pre-existing mailer cap" fit the first observation, was repeated in
status reports for a day, and was half wrong the whole time. It was caught only because
someone noticed the *error text had changed* and said so instead of re-reporting the label.

The fix is a domain Supabase accepts. It is not applied on the current branch — that branch
never touches this file, and changing an unrelated failing test inside a feature slice is
how a real regression gets attributed to the wrong change.

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

The length limits deliberately duplicate the database's `check` constraints. Zod gives the
user a field error; the constraint is the actual control, because any authenticated user can
`PATCH` PostgREST directly and skip the form entirely.

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
PostgREST's behaviour.

Every migration is additionally verified **against the live project after the push**, with
`supabase db query --linked`, reading the output rather than trusting the push command.

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

1. **No end-to-end browser tests.** No Playwright. The flows are covered by component tests
   plus documented manual walkthroughs. This is the largest gap, and with more time it is
   the first thing I would add — the guest flow in particular, which will have the most
   users and the least supervision.
2. **No load testing.** Every number in the scale document is reasoned from documented
   limits and measured API behaviour. None is measured under load.
3. **The RLS suite is not reproducible from the repo alone.** It needs three accounts
   registered by hand through the app's own `/register` form against the hosted project,
   which couples the suite to the register flow — a signup regression breaks the RLS tests
   too, and that coupling is exactly what let one test fail for two different reasons under
   one label. A local `supabase start` stack seeded from a migration would fix both.
4. **Spotify itself is mocked in unit tests.** Real API behaviour is verified by documented
   manual probes — which is how three assumptions in the design were found to be false.
5. **The decision engine is unbuilt**, so its tests do not exist. It is designed as a pure
   function precisely so that when it exists, its tests need no mocking.

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
