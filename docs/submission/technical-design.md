# Technical design

Deliverable 4. Folder structure, components, schema, CRUD, API, business logic, state,
error handling, validation, UX.

**Status.** Everything described is merged and running unless a section says otherwise.
The Spotify connect flow and the taste report are designed and planned but not yet built;
they are marked where they appear. Companion documents: `security.md`, `scale.md`,
`test-plan.md`, `product.md`.

---

## 1. The shape of the thing

Next.js App Router, TypeScript, Supabase Postgres, deployed on Vercel. Three decisions
determine almost everything else:

**Authorization lives in the database.** Every table has Row Level Security with a policy
per verb. Application code cannot grant itself access it doesn't have, and a DAL that
forgets a filter returns nothing rather than everything. This is the single most consequential
choice in the project and §5 is mostly about it.

**Server Components by default.** Data access happens on the server; only rendered output
crosses the wire. A Client Component appears where interaction demands it and nowhere else.

**Writes are per-item server actions, not save buttons.** Each add and remove is one row,
written immediately.

---

## 2. Folder structure

```
src/
  app/                      routes — every page is a Server Component
    page.tsx                marketing homepage
    login/  register/       auth screens
    auth/callback/route.ts  OAuth/confirmation callback
    dashboard/              the DJ's landing screen
    events/[id]/            the event page — DJ and couple share it
    events/[id]/live/       the DJ's live screen once the event starts
    events/[id]/recap/      the post-event playlist
    events/past/ events/upcoming/  past and upcoming events
    join/[token]/           the guest's screens — no auth, no shell (§3, §11)
    join/[token]/songs/     the guest's search-and-suggest picker
    join/[token]/search/route.ts   the one guest-reachable HTTP endpoint
    api/spotify/search/     a GET proxy to Spotify search
    api/live/[id]/state/route.ts   the DJ's 8-second poll
    api/live/[id]/enrich-artist/route.ts   one-artist-per-call genre enrichment
  components/
    auth/ brand/ dashboard/ events/ home/ shell/
    events/detail/          the event page's blocks, one per section
    live/                   the DJ's live-screen blocks (header, queue, cues, QR modal…)
    guest/                  the guest's blocks (join form, picker, queue, toast)
  lib/
    auth/                   dal, actions, error mapping, redirects, site-url
    dashboard/              queries, formatting, row→view mapping
    events/                 the event page's DAL, actions, types, pure helpers
    genres/                 the curated vocabulary
    guest/                  the guest session cookie (§5)
    live/                   the ranking engine, live DAL/actions, guest DAL/actions, QR, phase clock
    spotify/                client, app token, search, tracks, types
    supabase/               server and proxy clients
    validation.ts           every Zod schema outside the live-event slice
supabase/migrations/        fifteen migrations, applied in filename order
scripts/
  seed-demo.mjs             demo data for the linked project, including a live event
                            seeded through the real guest RPCs (§6)
  dev/pg-replica.sh         apply every migration to a scratch database
docs/submission/            these documents
```

**Two structural rules earn their keep.**

`lib/<domain>/` splits into `dal.ts` (reads, `server-only`), `actions.ts` (writes,
`'use server'`) and `types.ts` (shapes, neither). The types file exists **because** the
others carry `import 'server-only'`: a Client Component needs the row shapes and must not
pull in the module that talks to the database. Splitting them is a boundary, not tidiness —
and `server-only` makes crossing it a build error rather than a runtime leak.

One component per block of a screen, colocated with its CSS module and its test. The event
page is nine components rather than one, which is what let the couple's view differ from the
DJ's by adding a prop rather than forking a page.

---

## 3. Main components

### The event page — `/events/[id]`

The most complex screen, and the only one two roles share.

```
page.tsx (Server)
  requireUser → getEventDetail → resolveViewer → notFound() if neither
  └─ EventDetailScreen (Client, takes `viewer`)
       ├─ StepHeader
       ├─ StreamingSection      per-partner connect status
       ├─ CeremonySongs         two named slots
       ├─ MustPlaySection ×2    reception, party
       ├─ BlocklistSection ×2   reception, party
       ├─ NotesSection          DJ only
       ├─ SharedNotesSection    both
       └─ EventDetailsForm
```

`resolveViewer(userId, djId, partners)` is a pure function returning `{role:'dj'}`,
`{role:'partner', partnerId}` or `null`. The route turns `null` into `notFound()` — **a 404,
never a 403**, so the page cannot be used to discover which event ids exist.

Every form is a **sibling**, never nested. HTML drops a `<form>` inside another, so a nested
button silently does nothing. `EventDetailScreen.test.tsx` carries
`assertNoFormIsNestedInAnotherForm()` — and that assertion was once vacuous, which is why
§9 says what it does.

### `TrackPicker` — one component, three call sites

Every song enters the system by being **picked from Spotify**, never typed, because the
decision engine cannot reason about a string (see §7). The picker debounces ~300 ms, aborts
the in-flight request per keystroke, renders six results, and writes hidden inputs.

Its three call sites need different field names, so the names are a prop. That was not
obvious: it was specified from the one call site that never needed form association, and the
other two would have broken on landing.

### The live screen — `/events/[id]/live`

```
page.tsx (Server)
  requireUser → notFound() unless dj_id matches → PreFlight (upcoming) or LiveScreen (live)
  └─ LiveScreen (Client, driven by props + an 8s poll, §6)
       ├─ LiveHeader          couple, elapsed time, phase picker, QR button, End event
       │    ├─ EndEventControl    imports feat/upcoming-events' own endEvent (§5)
       │    └─ GuestQrModal       server-rendered SVG, print stylesheet
       ├─ CeremonyCues        the two named ceremony slots, "Play now" hides once played
       ├─ RequestQueue        ranked rows, each with a WHY line (§7)
       ├─ BlockedGroup        do-not-play matches, collapsed
       ├─ CoupleRules         must-play / played / do-not-play, three columns
       └─ GuestActivity       last hour of requests and votes, aria-live
```

Every action (`setPhase`, `playSuggestion`, `skipSuggestion`, `playPick`, `endEvent`) is taken
as a prop from the page, the same pattern §3's event page already uses for `saveEventDetails`
— no Client Component here imports a server action directly. `LiveScreen` itself owns no
fetch loop of its own; `useLivePoll` (§8) wraps it without restructuring anything underneath.

### The guest's screens — `/join/[token]`

No auth, no shell, no navigation — a guest is on a phone in a dark room for ninety seconds.

```
/join/[token]/page.tsx (Server)
  shape-check the token -> notFound() if malformed (§5)
  guest_event(token) -> couple names + live/ended state, no session required yet
  └─ JoinForm (Client) -> joinAction -> sets the session cookie, routes to /songs

/join/[token]/songs/page.tsx (Server)
  reads the session cookie; no cookie or no_such_session -> back to /join/[token]
  guest_queue(session) -> the guest's own view of the pending queue
  ├─ GuestPicker (Client)   search (via /join/[token]/search) + suggest, cap footer
  └─ GuestQueue (Client)    ranked rows, back someone else's song
```

Both pages call the same six `security definer` functions the guest server actions wrap
(`guestActions.ts`, `guestDal.ts`) — never a direct table read or write, because `anon` holds
no table grants at all (§5).

---

## 4. Database schema

Twelve tables and one view. `dj_id`/`user_id` reference `auth.users`.

```
profiles ──── auth.users
                  │
events ───────────┘        dj_id, couple_names, venue, event_date, status, phase
  ├── event_partners       slot 1|2, display_name, invite_email, user_id (null until claimed)
  │     ├── spotify_connections   status, spotify_user_id, connected_at
  │     ├── spotify_tokens        refresh_token (encrypted) — its own table, §5.3
  │     ├── taste_profiles        top_artists, genre_weights (jsonb)
  │     └── enrichment_queue      artist_id, position, claimed_at, settled_at
  ├── event_must_play      segment, title, artist, moment, spotify_track_id NOT NULL
  ├── event_blocklist      segment, entry_type, value, spotify_id
  ├── event_private_notes  DJ only
  ├── event_shared_notes   both
  ├── played_songs         position, title, artist, suggested_by, spotify_track_id (nullable)
  ├── guest_sessions       display_name, search_count — a guest's whole identity, no auth.uid()
  │     ├── song_suggestions    spotify_track_id, title, artist (untrusted display text), status
  │     └── suggestion_votes    (suggestion_id, guest_id) primary key — a double-vote is a no-op
  ├── spotify_tracks       a catalogue-cache CHILD TABLE, keyed by spotify_track_id
  └── spotify_track_artists    (spotify_track_id, ordinal) — one row per artist, not a parallel array

artist_genres              a cache keyed by spotify_artist_id
past_events_with_counts    a view, security_invoker = on
```

### Five decisions worth defending

**Ownership is derived, never denormalised.** `event_must_play` has no `dj_id`; its policy
asks `events` whose the parent is. A copied `dj_id` could drift out of sync with the event's;
a derived one cannot.

**Notes are two tables, not two columns.** RLS is per-row and cannot restrict columns, so a
private note living on `events` would be readable by anyone who can read the row. Since the
couple must read the event, both note kinds moved out — and `events` now has no column a
partner may not see.

**Refresh tokens have their own table.** Same reasoning one level down: a token beside a
status the other partner may read would be readable by them too. `spotify_tokens` carries an
owner-only policy — not the DJ, not the other partner.

**Two identity schemes on the blocklist, and two partial indexes.** An artist or song entry
is identified by its Spotify id; a genre entry by `lower(value)`, because Spotify has no
genre search. A `check` constraint enforces that exactly one applies per row.

**`spotify_track_artists` is a child table, one row per artist — never a parallel array
alongside `spotify_tracks`.** Two arrays kept in lockstep need a length-and-order invariant
enforced somewhere, and a Postgres `CHECK` cannot express "these two arrays have the same
length" at all (a `CHECK` cannot contain a subquery — found the hard way, replaying this
slice's own migrations against a throwaway Postgres, `security.md` §8.9). A child table
makes the alignment structural rather than policed, and it is also the shape a lookup by
artist actually needs — the enrichment queue and the ranking engine both query "which artists
does this track have," never "give me the whole array back to iterate."

### Migrations

Fifteen files, applied in filename order, each verified against a scratch replica
(`npm run db:replica`) before being applied by hand to the live project — the CLI's push is
never trusted for verification; `supabase db query --linked` reads the result afterwards.
That harness has two known blind spots (`security.md` §8.9): its stub `auth.uid()` is always
null, so it proves no RLS *behaviour*, only that policies compile and CHECKs refuse what they
should; and it never runs PostgREST, so it cannot catch an ambiguous embed — PostgREST sees
two relationships between `song_suggestions` and `guest_sessions` (the direct FK, and an
implicit one through `suggestion_votes`), which is a real, previously-shipped `500` that only
a genuine HTTP call against the live database ever surfaced.

The six guest-facing functions (§6) were held in their own migration, separate from the five
new tables, deliberately: the tables alone cannot be reached by an unauthenticated caller
(`anon` holds no grant on them), so that migration could be reviewed and pushed on its own
schedule while the function migration — the only thing standing between the open internet and
this database — waited for a dedicated adversarial review to come back clean.

The Spotify id columns landed as **two** migrations, deliberately: the first added them
nullable, the second made them mandatory once every write path supplied one. A single
migration would have left a window where the schema demanded an id the code didn't yet
provide — and the natural fix for a red tree in that window is to relax the constraint the
work exists to add.

---

## 5. Authorization

Covered fully in `security.md`; the architectural points are here.

**Every policy names its verb**, and every `UPDATE` policy has both `using` and `with check`.
Without the second, a row could be re-parented onto another DJ's event: `using` admits the
row you own, and nothing then examines where you're moving it.

**`DELETE` filters, it does not raise.** A delete policy that excludes a row makes the
statement affect zero rows and return no error. So writes check affected-row counts rather
than the absence of an error — a distinction §9 returns to.

**Column-level grants where RLS cannot reach.** RLS is per-row. `event_partners.user_id` is
writable by *no* PostgREST role on either verb; only a `security definer` function sets it,
and only where the invitation matches the caller's own verified email. The same pattern
protects `profiles`.

**One helper function, and only where recursion demands it.** `is_event_partner(uuid)` is
`security definer` because `event_partners`' own policy must read `event_partners`. Every
policy keeps the DJ clause **inline and first**, so the common path stays index-backed —
Postgres does not inline `security definer` functions.

**A guest has no `auth.uid()`, so RLS has nothing to key on for the guest tables — `anon`
holds zero table grants on any of the five, full stop.** Instead, six `security definer`
functions (`guest_event`, `guest_join`, `guest_suggest`, `guest_vote`, `guest_queue`,
`guest_search_allow`) are the entire anon-reachable surface, each re-deriving the event from
the guest's own secret (the join token, or a session id a prior call minted) and doing exactly
one bounded thing. `revoke all on function … from public` precedes every grant — Postgres
grants `execute` to `PUBLIC` by default, so a function merely *not* granted to `anon` is still
callable by it. The two DJ-only play functions (`dj_play_suggestion`, `dj_play_pick`) are
`security invoker`, not `definer` — an earlier draft argued `definer` was needed to take an
advisory lock, which is false; `pg_advisory_xact_lock` needs no elevation at all, and the
existing `dj inserts/updates songs of own events` RLS policies are the real authorization for
both. Full detail, the trust rule that keeps a guest's title/artist text from ever being
matched on, and the abuse-limit table are in `security.md` §8.

---

## 6. CRUD and the API surface

There is no REST API of our own. Reads are Server Component function calls; writes are server
actions or (for the guest boundary) RPC calls to `security definer` functions. Three route
handlers exist: two proxies and one poll.

| Operation | Mechanism | Notes |
|---|---|---|
| Read an event + lists + partners | `getEventDetail` | **one** PostgREST call with embedded resources |
| Read dashboard events | `listActiveEvents` / `listRecentPastEvents` | index-backed |
| Read past-event counts | `past_events_with_counts` | a view; avoids N+1; "past" means `status = 'completed'` **or** an `upcoming` event whose `event_date` has already passed in `Asia/Jerusalem` |
| Add / remove a list row | server action, one row | `revalidatePath` with the **literal** path |
| Save notes | server action, **upsert** | never `update` — §9 |
| Search Spotify | `GET /api/spotify/search` | auth-gated; app token, no user |
| Start / change phase / play / skip / end an event | server actions | `startEvent`/`setPhase`/`playSuggestion`/`skipSuggestion`/`playPick` are this slice's own; `endEvent` is imported from `feat/upcoming-events`, never re-implemented, so `status = 'completed'` keeps exactly one writer |
| Poll the live screen | `GET /api/live/[id]/state` | DJ-only, every 8s; ranks server-side and resolves up to 10 unresolved tracks per cycle so the client payload never carries the blocklist or the couple's do-not-play list |
| Join / suggest / vote / read the queue / check the search budget | `guest_join` / `guest_suggest` / `guest_vote` / `guest_queue` / `guest_search_allow` RPCs | the entire guest write surface (§5); wrapped by `guestActions.ts`/`guestDal.ts`, never called from a component directly |
| Guest search | `GET /join/[token]/search` | the one HTTP endpoint reachable by an unauthenticated stranger; gated on the session cookie plus `guest_search_allow`, writes nothing (resolution happens later, on the DJ's own poll) |

**PostgREST embeds an ambiguous relationship, silently, until you ask it the right question.**
`song_suggestions` has two paths to `guest_sessions` — a direct FK, and an implicit
many-to-many through `suggestion_votes`, which itself FKs to both tables. An unqualified
`.select('…, guest_sessions(display_name)')` returns `PGRST201` (`more than one relationship
was found`) against real data, regardless of row count — and neither a mocked test nor the
scratch-Postgres replica can catch it, because neither one runs PostgREST's own
schema-relationship resolver. Fixed by naming the relationship explicitly:
`guest_sessions!song_suggestions_suggested_by_fkey(display_name)`, the exact disambiguation
PostgREST's own error `hint` names. Found by a real HTTP call against the live poll route, not
by review — the general lesson (§9, §12) is that a class of Postgres-shape defect exists that
only running the real stack can surface.

**Embeds return two shapes.** PostgREST returns a to-one embed as a JSON **object** and a
to-many as an array. `firstRow()` normalises both, because indexing `[0]` into an object
yields `undefined`, the field renders empty, and the next save writes `''` over real data —
a destroy, not a blank field.

**`revalidatePath` takes the literal path**, never the `'/events/[id]'` pattern: given a
dynamic pattern with no `type` argument, Next builds a tag matching nothing and returns
normally. The write lands, the screen doesn't change, nothing errors.

---

## 7. Core business logic

Deliberately concentrated in pure functions — no network, no database, no mocking.

| Function | Does | Where |
|---|---|---|
| `resolveViewer` | user + partners → role | `lib/events/viewer.ts` |
| `splitBySegment` | one list → ceremony/reception/party | `lib/events/segments.ts` |
| `normaliseGenre` / `facetOf` | a raw tag → genre, origin, era, or nothing | `lib/genres/` |
| `mergeRanges` | three Spotify ranges → one scored list | planned |
| `combineTaste` | two profiles → the DJ's report | planned |
| `rankQueue` | pending suggestions + rules + state → a ranked, annotated queue and a blocked list | `lib/live/rank.ts` |

**The genre vocabulary does two jobs with one list.** It is the picker's source, and it is
the filter that turns Last.fm's raw tags into genres. Unfiltered, live data reads *"hebrew,
pop, hairy chest"* — the tags include body types, platform names, decades and the artist's
own name. Four buckets: genre, origin, era, and discard. Origin and era are **facets, not
genres**: `israeli` must not sit beside `disco` as though they were the same kind of thing.

**The decision engine is built, not just designed — this is the product's actual
differentiator, and CLAUDE.md names it as the thing the whole slice exists to make possible.**
`rankQueue` is a pure function, no I/O, that crosses seven inputs — the do-not-play list,
which unplayed must-plays remain, requester count, the current event phase, minutes left in
that phase, the artist-repeat limit, and what has already played — into a ranked, **explained**
list. Every ranked row carries `Reason[]`, rendered by `reasons.ts` as a capped, plain-English
line: *"12 people asked for it, but this artist repeated 2 songs ago."* A song that matches the
do-not-play list is removed into a separate `blocked` list with its own reason rather than
silently dropped, so the DJ can see and override a call the engine got wrong.

Genre matching is **best-effort, and the row says so.** An artist's genre depends on
asynchronous enrichment (MusicBrainz → Last.fm, one artist per request, §6 of `scale.md`), so a
freshly-suggested artist ranks with a visible `genre-pending` reason until enrichment catches
up — never a silent, unqualified pass. This is a deliberate, disclosed limit (`security.md`
§8.6), not an oversight: the alternative was blocking a suggestion from ranking at all until
its genre resolved, which would have made every new song invisible for the minutes enrichment
takes.

**Every one of the seven terms is unit-tested with a real mutation proof** (`test-plan.md`):
the real function is edited to remove the term, the suite is confirmed to go red, and the
file is restored — not asserted-and-trusted, because a test file's own claim to have proven
something is exactly the kind of statement this project has learned to verify rather than take
on faith (§9, §12).

Everything upstream serves it. **That is why every song is picked rather than typed**: "this
artist repeated two songs ago" needs an artist id, and "the couple banned this" needs the ban
and the candidate to be one value rather than two spellings. It is also why a guest's free-text
title/artist is never matched on (`security.md` §8.3) — a fabricated artist name would defeat
exactly this engine.

---

## 8. State management

**No state library.** None is needed, and adding one would be the most obvious unnecessary
dependency in the project.

- **Server state** — fetched per request in Server Components. No client cache to invalidate.
- **After a write** — `revalidatePath` re-renders on the server. The client holds nothing to
  update.
- **Form state** — `useActionState` in the one component that renders a result.
- **Ephemeral UI state** — `useState`, local to the component (the picker's query, the
  dropdown's visibility).
- **Polling** — `useLivePoll` (the DJ's live screen only) refetches `GET /api/live/[id]/state`
  every 8 seconds and holds the last good render across failures. This is the one place the
  app keeps client state past a single render, and it is a deliberate exception: realtime is
  out of scope (a websocket configuration this project does not have), and a DJ's decision
  cycle is a three-minute song, so 8 seconds buys enough freshness without it. It deliberately
  does **not** copy `useEnrichmentPoll`'s "stop on any non-ok response" behaviour — that is
  right for a finite background job and wrong for a live screen, where one network blip would
  freeze the DJ's queue for the rest of the night. On failure: retry with backoff, never blank
  the queue, show a small "Reconnecting…" marker instead.

The interesting consequence: **a Client Component here is a leaf.** Nothing lifts state up,
because there is nowhere to lift it to — `useLivePoll` is the one exception, and it is scoped
to exactly the screen that needs freshness past the first render.

---

## 9. Error handling

Three rules, each from a bug that actually shipped.

**Never leak provider detail.** `lib/auth/errors.ts` maps every Supabase error to a generic
string and logs the detail server-side. Login failure is identical for an unknown email and a
wrong password. `SpotifyError` carries kind, status and endpoint — **never** the response
body, because a body reaching a client string is one refactor from a body reaching a user.

**A silent zero-row write is the recurring bug of this project — five occurrences.** A
policy admitting no rows *filters*; an `UPDATE` against a missing row returns *success*.
Three mitigations: writes **upsert**, backfills cover every row, and deletes call `.select()`
and treat zero rows as failure.

**Rate limits are normal operation, not exceptions.** A Spotify 429 retries once honouring
`Retry-After`, then returns a typed error the UI renders as "busy, try again".

**A guest's errors are a closed, named set — never a raw database message.** All six guest
functions raise a bare `raise exception '<code>'`, which every one of them surfaces as
SQLSTATE `P0001` — so the mapping in `guestErrors.ts` switches on `error.message`, not
`error.code`, and is a `Record<GuestErrorCode, string>` so `tsc` fails if a code is ever added
without a matching user-facing string. `no_such_event` and `event_not_live` are kept as two
distinct codes on purpose, even though `guest_join` could combine them into one query — the
guest's screen has to tell "that link isn't valid" apart from "this event hasn't started yet,
or it's over," and one combined predicate can only ever produce one failure.

**Never generate output for a value already known to be broken.** The QR modal computes the
join URL and its SVG only when the event's `join_token` is non-null; a null token — a `live`
row that somehow never went through the normal minting path — produces neither, and the
header shows an explicit "No guest link for this event" note instead. A first draft did the
opposite: built a URL with an empty token segment and rendered a QR for it, which is the one
place in this app a silently-wrong value would have reached paper rather than a screen. Caught
by review before merge, and generalised here because the same principle applies anywhere a
value that can be null feeds something the user cannot easily fix once it's produced.

---

## 10. Input validation

Three overlapping layers, deliberately:

| Layer | Catches | Why it is not redundant |
|---|---|---|
| Zod, shared client/server | shape, length, format | one schema, so the two cannot disagree |
| Postgres `check` | the same rules | **the actual control** — any authenticated user can `PATCH` PostgREST and skip the form |
| Postgres types | structural impossibility | a non-uuid never reaches a query |

Validation runs **after** `requireUser()` and **before** the database. Ordering matters: an
unauthenticated caller is refused before their input is parsed. Spotify ids validate as
`/^[A-Za-z0-9]{22}$/` in Zod *and* as a `check` constraint.

Output encoding is React's. `dangerouslySetInnerHTML` appears exactly once, for a
server-generated QR code SVG rendered from a URL this app fully controls (see `security.md`
§8.8 for why that one case is safe and deliberate).

---

## 11. Core UX

Built from a Claude Design canvas — ten artboards, the visual source of truth. Deviations are
deliberate and stated; the largest is that **every song field is a picker, not free text**,
which §7 explains.

Three decisions worth naming:

**Per-item writes, not a save button.** A DJ adding five songs makes five small requests
rather than one batch — and a DJ who closes the tab loses nothing.

**Dedupe surfaces in the results, not after submission.** A guest searching for an
already-suggested song sees it marked with its vote count and a *Vote* action instead of
*Suggest*. They never hit a rejection.

**Empty and degraded states render as themselves.** "Not enough listening history" is not
"0% match" — one is about the data, the other about the couple. A report waiting on
enrichment says so; it does not render four empty bars.

**The guest's screens are deliberately austere — no sidebar, no DJ branding, no navigation.**
A guest is holding a phone in a dark room for ninety seconds; every element on `/join/[token]`
and its picker earns its place against that constraint. The QR modal's "Print table cards" is
pure `window.print()` against a `@media print` stylesheet — a 2×4 grid on A4 — rather than a
PDF-generation dependency, because the paper size is then the browser's problem, not this
app's.

---

## 12. What I would change

1. **A generated Supabase `Database` type.** Its absence is why two bugs reached runtime with
   `typecheck` green — untyped `data` accepts indexing an object as an array.
2. **A real browser walk-through of the guest flow, not just integration tests against the
   live database.** The guest RPCs' guards (the cap, dedupe, cross-event rejection, the RLS
   grants) are proven against real Postgres (`test-plan.md`); the three guest SCREENS built on
   top of them have unit and component tests but no automated end-to-end run. `manual-tests.md`
   covers this with a real walk before submission, but it is not repeatable in CI.
3. **A local Supabase stack for the test suite**, so its guarantees are reproducible by a
   grader rather than only by me.
4. **A per-event session ceiling.** `security.md` §8.5 names this as the honest fix for the
   one gap this slice ships with knowingly: nothing today bounds how many guest sessions a
   token-holder can mint, and therefore nothing bounds votes.
5. **The anonymous-sign-ins audit** (`security.md` §9.14) — the better long-term design for the
   whole guest boundary, set aside for this slice because it needs a full policy review this
   deadline didn't have room for, not because the current design is preferred.
