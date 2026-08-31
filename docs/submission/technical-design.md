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
    events/[id]/recap/      the post-event playlist
    events/past/            past events
    api/spotify/search/     a GET proxy to Spotify search
  components/
    auth/ brand/ dashboard/ events/ home/ shell/
    events/detail/          the event page's blocks, one per section
  lib/
    auth/                   dal, actions, error mapping, redirects, site-url
    dashboard/              queries, formatting, row→view mapping
    events/                 the event page's DAL, actions, types, pure helpers
    genres/                 the curated vocabulary
    spotify/                client, app token, search, types
    supabase/               server and proxy clients
    validation.ts           every Zod schema, in one file
supabase/migrations/        eight migrations, applied in filename order
scripts/
  seed-demo.mjs             demo data for the linked project
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
  └── played_songs         position, title, artist, suggested_by

artist_genres              a cache keyed by spotify_artist_id
past_events_with_counts    a view, security_invoker = on
```

### Four decisions worth defending

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

### Migrations

Eight files, applied in filename order, each verified against a scratch replica
(`npm run db:replica`) before being applied by hand to the live project — the CLI's push is
never trusted for verification; `supabase db query --linked` reads the result afterwards.

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

---

## 6. CRUD and the API surface

There is no REST API of our own. Reads are Server Component function calls; writes are server
actions. The one route handler is a proxy.

| Operation | Mechanism | Notes |
|---|---|---|
| Read an event + lists + partners | `getEventDetail` | **one** PostgREST call with embedded resources |
| Read dashboard events | `listActiveEvents` / `listRecentPastEvents` | index-backed |
| Read past-event counts | `past_events_with_counts` | a view; avoids N+1 |
| Add / remove a list row | server action, one row | `revalidatePath` with the **literal** path |
| Save notes | server action, **upsert** | never `update` — §9 |
| Search Spotify | `GET /api/spotify/search` | auth-gated; app token, no user |

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

**The genre vocabulary does two jobs with one list.** It is the picker's source, and it is
the filter that turns Last.fm's raw tags into genres. Unfiltered, live data reads *"hebrew,
pop, hairy chest"* — the tags include body types, platform names, decades and the artist's
own name. Four buckets: genre, origin, era, and discard. Origin and era are **facets, not
genres**: `israeli` must not sit beside `disco` as though they were the same kind of thing.

**The decision engine is designed and not built.** It ranks the next song by crossing the
blocklist, unplayed must-plays, requester count, event phase, time remaining, the
artist-repeat limit and what's been played — and **returns why**. It is specified as a pure
function from state to a ranked, annotated list precisely so its tests need no mocking.

Everything upstream serves it. **That is why every song is picked rather than typed**: "this
artist repeated two songs ago" needs an artist id, and "the couple banned this" needs the ban
and the candidate to be one value rather than two spellings.

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

The interesting consequence: **a Client Component here is a leaf.** Nothing lifts state up,
because there is nowhere to lift it to.

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

Output encoding is React's. There is no `dangerouslySetInnerHTML` anywhere.

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

---

## 12. What I would change

1. **A generated Supabase `Database` type.** Its absence is why two bugs reached runtime with
   `typecheck` green — untyped `data` accepts indexing an object as an array.
2. **End-to-end tests.** The largest gap; the guest flow most of all.
3. **A local Supabase stack for the test suite**, so its guarantees are reproducible by a
   grader rather than only by me.
4. **The decision engine**, which is the product's actual differentiator and is currently a
   design with a test plan and no code.
