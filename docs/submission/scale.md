# Scale

Deliverable 7. How Spinit behaves at tens and hundreds of users, where the heavy queries
are, what the indexes do, how over-fetching is avoided, where the client/server split falls,
what the current limits are, and what I would improve with more time.

**Status.** §1–§5 describe merged code. §6 describes the Spotify integration, designed and
partly built on `feat/spotify` but not merged, plus §6.6 which covers the live-event slice's
own Spotify usage and IS merged and running. §7 is the honest list of limits.

---

## 1. What "scale" means for this product

Spinit is not a service with a smooth load curve. It has two shapes of load and they are
almost opposites:

| | DJ-facing | Guest-facing |
|---|---|---|
| Users | 1 per event | 50–300 per event |
| Concurrency | one person, occasional | everyone at once, at the same moments |
| Session | hours, planning | minutes, at a wedding |
| Auth | logged in | **anonymous** |
| Reads | small, indexed | one hot query, repeated |
| Writes | a row at a time | a burst per song |

The DJ side is a small CRUD application and will not be the thing that breaks. The guest
side is a **thundering herd on a single event row** — two hundred phones on one venue's wifi,
searching and voting during the same three-minute window when the DJ announces the QR code.

Everything below is sized against the guest side, because that is the side with a number.

The realistic ceiling this product needs is **one event at a time, a few hundred guests**.
A DJ works one wedding a night. That is a far friendlier target than "hundreds of concurrent
users" sounds, and it is worth saying plainly rather than designing for traffic that will
never arrive.

---

## 2. The queries, and what makes each of them cheap

### 2.1 The dashboard

`listActiveEvents` and `listRecentPastEvents` — one DJ's events, filtered by status, newest
first.

```sql
create index events_dj_status_date_idx on public.events (dj_id, status, event_date desc);
```

The two equality columns lead so the lookup is index-backed, and `event_date desc` matches
the sort. A DJ with 200 past events reads an index range, not a table.

### 2.2 The past-events count

Each past event shows how many songs were played. The naive version is N+1: one query for
the events, then one per event for its count. A view collapses it:

```sql
create view public.past_events_with_counts
with (security_invoker = on) as
  select ... where status = 'completed'
     or (status = 'upcoming' and event_date < today in Asia/Jerusalem) ...
```

An event counts as "past" when the DJ has ended it, or when its date has already passed —
not `status = 'completed'` alone. Before this the view could only ever return seeded rows,
because nothing in the application wrote `'completed'`.

`security_invoker = on` matters more than the aggregation. Without it the view would run
with its **owner's** rights and bypass RLS entirely — a scale optimisation that quietly
becomes an authorisation hole. It is the one place in the project where a performance
decision and a security decision are the same decision.

It also has a consequence worth recording, now live on the project. Widening `events` SELECT
so the couple can read their own event propagates into this view, because `security_invoker`
means it runs with the *caller's* rights. A partner on a completed event now sees that row
with `songs_played` always **0** — `played_songs` was deliberately not widened, so the left
join is filtered to nothing. Nothing leaks; the count is simply wrong rather than absent.
Two correct controls meeting and producing a number that looks like a bug. Unreachable
through the interface today, and recorded rather than patched because fixing it means
deciding whether a partner may see `played_songs` at all.

The honest caveat: grouping forces a sort above the aggregate, so
`events_dj_status_date_idx` does not serve the ordering when read through the view. At a few
hundred rows per DJ that is irrelevant. At a hundred thousand it would need a materialised
count column maintained by trigger.

### 2.3 The event page

One page, one round trip. `getEventDetail` reads the event and both song lists in a single
PostgREST call using embedded resources:

```
events?id=eq.<id>&select=...,event_must_play(...),event_blocklist(...),event_partners(...)
```

Three tables, one HTTP request, one query plan. The alternative — three sequential awaits —
would triple the latency for no benefit, since the page cannot render until all three arrive.

Both list tables carry a covering index:

```sql
create index event_must_play_event_segment_idx on public.event_must_play (event_id, segment, created_at);
```

### 2.4 Ordering is not free, and `created_at` alone is not stable

`now()` is **transaction start time**, not wall-clock. Every row written by one multi-row
insert gets a byte-identical `created_at`, and `order by created_at` alone leaves PostgREST
returning tied rows in whatever order the executor picks — which can differ between reads.

Every ordered read therefore adds the primary key: `order by created_at, id`. This was a
real bug in `detailDal.ts`, design-reviewed and shipped, caught before push. It is a
correctness issue that presents as a scale issue, because it only shows up once there is
enough data to tie.

### 2.5 The live poll — the one query this product runs on a fixed clock, not on demand

`GET /api/live/[id]/state` is polled every 8 seconds for the whole duration of an event,
which makes it the only query in this product whose call volume is driven by a timer rather
than a person clicking something. Three index-backed reads, one per poll:

```sql
create index guest_sessions_event_idx on public.guest_sessions (event_id);
create index song_suggestions_event_status_idx on public.song_suggestions (event_id, status, created_at);
create index suggestion_votes_guest_idx on public.suggestion_votes (guest_id);
```

The vote count is **tallied in TypeScript from a second bare-column query**, not
`suggestion_votes(count)` embedded on the first — PostgREST's aggregate functions are gated
behind `db-aggregates-enabled`, and this project's setting was verified with one `curl` rather
than assumed from the client library's own type signatures accepting the syntax. One extra
round trip, no redesign, and a claim about a dependency's configuration that was checked
rather than guessed.

**Ranking happens on the server, every poll, and never crosses the wire.** `rankQueue` runs in
the route handler; the client receives ranked rows with their reasons already attached, never
the do-not-play list or the couple's must-play list itself. Smaller payload, and one fewer
copy of the couple's private rules sitting in a place it does not need to be — a scale
decision and a security decision again turning out to be the same decision, as `security.md`
§8's genre and blocklist matching already establishes.

---

## 3. Avoiding over-fetching

**Select lists are explicit.** No `select('*')` anywhere. The dashboard reads five columns
from `events`, not the whole row; the recap reads what it renders.

This is also a security property: `select('*')` on a table that later gains a sensitive
column leaks it silently. The Spotify work removed `notes` from `events` entirely rather
than rely on select lists staying narrow (see the security doc, §3).

**Row limits at the source.** Spotify search asks for `limit=10` and renders 6. Top-artist
reads ask for the API's maximum in one call rather than paging.

**Nothing is fetched for a screen that will not render it.** The taste report's genre panels
read a table the artist panels do not touch, so a report rendered before enrichment finishes
makes fewer queries, not more.

**No client-side filtering of server data.** Where a list is filtered, the filter is in the
query. `splitBySegment` is the one exception — it partitions an already-fetched list of at
most a few dozen rows into ceremony/reception/party, which is cheaper than three queries.

---

## 4. The client/server split

**Server Components by default.** Every page is a Server Component; data access happens on
the server and only rendered output crosses the wire. The browser never holds a Supabase
client with elevated rights, never sees a query, and downloads no data-access code.

**Client Components only where interaction demands it** — the components that must render a
server action's result (`useActionState`), and the pickers that need `onChange`. Each is as
small as it can be, so the interactive leaf does not drag its parent tree into the bundle.

**`import 'server-only'`** on every DAL makes the boundary a build error rather than a
convention. This is why `detailTypes.ts` exists separately from `detailDal.ts`: the client
components need the row *types* without pulling in the module that talks to the database.

**Writes are per-item server actions, not a save button.** Each add and each remove is one
row inserted or deleted, immediately, followed by `revalidatePath()`. The alternative — one
Save that diffs each list — would need to read the whole list back, compute a diff, and
issue a batch, and a DJ who closed the tab would lose everything typed.

The cost is one round trip per item instead of one per screen. For a DJ adding five songs
that is five small requests, which is the right trade for a form that is edited over weeks.

---

## 5. Pagination

**Not implemented, deliberately, and the reasoning differs per screen.**

- **Dashboard** — a DJ has a handful of upcoming events. Bounded by reality.
- **Past events** — grows unbounded over a career. **This is the one screen that will need
  pagination**, and the index already supports it: `(dj_id, status, event_date desc)` serves
  keyset pagination on `event_date` with no schema change. Not built because a DJ with 200
  past events is a DJ this project has not yet had.
- **Song lists** — a wedding's must-play list is tens of rows. Paginating it would be worse
  UX for no gain.
- **Spotify search** — capped at 10 by the API, and deliberately not paged (§6.3).

Where pagination is absent, it is because the row count is bounded by something real, not
because it was forgotten.

---

## 6. The Spotify integration

This is where the actual scale constraints live, because they are imposed by other people's
APIs.

### 6.1 The hard external ceiling

**A development-mode Spotify app may authorise at most 5 users, ever.** Extended quota has
been organisations-only since 2025-05-15 and requires a registered business. There is no API
to manage the allowlist and no path to raising it.

This is not a limit the architecture can design around — it is a property of the product's
environment. What the architecture *can* do is confine it, and it does: the 5-user cap
applies only to **user-scoped** tokens. Search runs on an app-level client-credentials
token, which needs no user at all.

So the two partners who connect are constrained; **the hundreds of guests who search are
not.** The one place the product needs to scale is the one place Spotify does not limit.

### 6.2 Rate limits

Spotify's limit is measured **per app, in a rolling 30-second window**, on development
mode's lower tier — shared across every event in the project simultaneously. Three
mitigations, in order of effect:

1. **Persist every track and artist seen.** After the first hour of an event most searches
   resolve from Postgres without touching Spotify. Wedding guests search the same fifty songs.
2. **Debounce the search box ~300 ms** and abort the in-flight request per keystroke. Roughly
   a 5× reduction for free.
3. **Handle 429 explicitly** — read `Retry-After`, retry once, then return a typed error the
   picker renders as "busy, try again" rather than throwing.

### 6.3 Why search is not paginated

`limit` maxes at 10 (down from 50 in February 2026) and `offset` still accepts 0–1000, so
depth is available — at one request per ten results, against a shared per-app limit.

A guest who cannot see their song in ten results is better served by a better query than by
page two, and the empty state says so: *"Try adding the artist name."* Real behaviour on a
phone at a wedding is to retype, not to page.

The couple's onboarding is the opposite context — two people at a table, deliberately
building lists, no concurrency — and pagination there costs nothing. **Shallow for guests,
deep for the couple**, driven by the concurrency profile of each role rather than by one
global rule.

### 6.4 Enrichment: the expensive path, bounded

Genre data requires MusicBrainz (2 calls) plus Last.fm (1 call) per artist, at 2-second
pacing because MusicBrainz's documented 1 req/sec is a floor that 503s under load. That is
~5 seconds per artist, ~100 seconds for a partner's top 20.

Four things make that survivable:

**The cache is global and permanent.** `artist_genres` is keyed by Spotify artist id with no
event dimension, so two weddings both wanting Ed Sheeran cost one enrichment **ever**, across
the whole project. Per-artist cost is paid once, not once per couple.

**It runs in two phases.** Phase 1 (three Spotify calls, sub-second) writes the artists and
the page renders immediately. Phase 2 fills genres behind it. The report is useful the
moment it connects and honestly degraded if enrichment never finishes.

**It is client-polled, one artist per request.** An earlier design used Next's `after()` —
which runs inside the route's `maxDuration` and is **cancelled** on timeout, so a 100-second
job would have been killed partway, leaving profiles stuck in "analysing" forever. Replacing
it with a poll that does one artist per call means no request approaches any timeout, the
work is resumable, and progress is a real count rather than a spinner.

**The claim is a row lock** (`for update skip locked`), so two tabs — or a partner and their
DJ — cannot double-enrich the same artist. "One artist in flight" is enforced rather than
assumed.

### 6.5 The batch-fetch removal

Spotify removed `GET /artists?ids=` for development-mode apps, so artists must be fetched
one at a time. Hydrating 50 artists is 50 requests where it used to be 1.

The global cache is what makes this tolerable, and it is why the cache is global rather than
per-event. Without it, this constraint alone would make the feature impractical.

### 6.6 The live event's own Spotify usage — merged and running, not designed

Two places in the live-event slice call Spotify, and both are load-bearing for the same
reason §6.1 already names: the guest side is the side with a real number, so it is the side
that gets a bound.

**Resolving a suggestion's track, on the DJ's own poll, bounded at 10 per cycle with
concurrency 5.** `resolveTracks(ids, { max: 10, concurrency: 5 })` runs against Spotify's
**singular** `GET /tracks/{id}` endpoint, never the batch `GET /tracks?ids=` — verified by a
real call with this app's own client-credentials token: the singular endpoint and `/search`
both return 200, the batch endpoint returns **403, three retries, with and without the
`market` parameter**, consistent with Spotify's post-2024 access tiers gating some catalogue
endpoints for development-mode apps. No documentation was found confirming the cause; the
behaviour itself is verified, not assumed, which is the standard the rest of this document
already holds every other Spotify claim to. Capping at 10 unresolved tracks per poll, with 5
in flight at once, bounds worst-case Spotify calls per 8-second cycle to a small, fixed
number regardless of how many suggestions are pending — a full queue of 40 pending suggestions
still costs at most 10 calls per cycle, not 40, and the remaining 30 resolve over the next
three cycles.

**Guest search shares the one Spotify app token every event in this project uses.**
`guest_search_allow`'s per-session ceiling of 60 (§6.2, `security.md` §8.4) exists
specifically to protect this shared token from one guest session's unlimited searching — the
same cross-tenant concern §6.1 raises for the couple's own connect flow, one layer down at the
guest boundary instead. **The ceiling is per session, and nothing bounds session-minting**
(`security.md` §8.5), so this protection is real against an ordinary guest and not against a
determined one holding the token — recorded here as a scale-relevant instance of a security
gap already disclosed, not a new finding.

---

## 7. Current limits

Ordered by how soon each would bite.

1. **5 Spotify users, ever.** The hardest limit in the product. Budget: two for the demo
   couple, one for development, two spare.
2. **No rate limiting of our own** on the search proxy. It requires a session, but signup is
   open, so that is a speed bump rather than a control. A per-user limiter is the first thing
   I would add for real traffic.
3. **The app token cache is per serverless instance.** Each Vercel instance mints its own.
   Allowed and expected, but it means the effective request rate against Spotify scales with
   instance count, not with users.
4. **Past events will need pagination** eventually. The index is already right for it.
5. **The view's count does not use the index for ordering.** Irrelevant at hundreds of rows.
6. **No connection pooling configuration.** Supabase's pooler is used at its defaults; under
   real concurrency the pool mode and size would need deliberate choice.
7. **The artist cache is never invalidated.** `fetched_at` is stored and nothing reads it, so
   a wrong genre is permanent.
8. **Vercel and Supabase free tiers.** Function duration, bandwidth and database size all
   have ceilings this project has not approached and would meet quickly under real use.
9. **No load testing has been done.** Every number here is reasoned from documented limits
   and measured API behaviour, not from a load test. That is a real gap and I would rather
   state it than imply otherwise.
10. **The 8-second live poll's cost scales with pending suggestions, not with guest count.**
    A guest joining or voting is one small RPC; the DJ's poll re-ranks the whole pending queue
    and resolves up to 10 unresolved tracks every 8 seconds regardless of how many guests are
    connected, because there is exactly one DJ screen per event. This is favourable, not a
    risk — it is named here so it is not accidentally conflated with the guest-count numbers
    in §1.
11. **Nothing bounds guest session-minting**, and therefore nothing bounds either votes or the
    60-search-per-session budget's real effectiveness (`security.md` §8.5). A per-event
    session ceiling is the honest fix and is not built.
12. **`guest_sessions` and `song_suggestions` have no delete grant for any role — including the
    DJ — so both grow permanently, and this is measured rather than reasoned.** Every run of
    `guest.integration.test.ts` mints fresh guest sessions and suggestions on the shared,
    live `sara-daniel` fixture event and cannot clean them up afterward (§5.4 of
    `test-plan.md` already names this as a known cost of that suite). Observed directly,
    twice in one evening: the event accumulated to 214 guest sessions and 167 pending
    suggestions before a demo walk, and a single subsequent gate run alone added 28 more
    pending suggestions. Both times the DJ's own existing `update` grant was used to move the
    accumulated rows to `status = 'skipped'` — a legitimate state the schema already has,
    within existing grants, and the only lever available; the rows themselves cannot be
    reclaimed, only hidden from the pending queue. This sits on the hot path of the live
    screen's main poll query (§2.5), so unlike most of this document's numbers, it is not a
    future concern — it is already true today, every time the test suite runs against the
    linked project.

---

## 8. What I would do next, in order

1. **Load-test the guest path** — 200 simulated phones searching and voting on one event.
   Everything above is reasoning; this would be evidence. It is first because it would
   tell me which of the remaining items actually matter.
2. **A per-user rate limiter** (Upstash Redis or similar) on the search proxy and the auth
   actions.
3. **Keyset pagination on past events**, which the existing index already supports.
4. **A `played_songs_count` column** on `events`, maintained by trigger, retiring the view's
   aggregate.
5. **Age out the artist cache** on `fetched_at`, so genre data can be corrected.
6. **Realtime, replacing the DJ's 8-second poll.** The poll exists and works — it holds the
   last good render on failure and never blanks the queue — but it is a deliberate choice of
   the simpler tool, not the absence of one. A DJ's decision cycle is a three-minute song, so
   sub-second freshness buys nothing against the cost of a websocket configuration this
   project does not have. Realtime would still be the better fit for the guest's own queue
   view, which currently has no live update at all — a guest sees the queue only when they
   open or reload the picker.
7. **A per-event guest session ceiling** (`guest_count * 3`, or a flat number where
   `guest_count` is null) — §7 item 11's honest fix, and the one item on this list that closes
   a disclosed security gap rather than only improving a number.
8. **A delete grant and a retention job for `guest_sessions`/`song_suggestions`** — §7 item
   12's fix, and the only item on this list backed by a measurement made three separate times
   in one evening rather than a projection.

The first is the one that matters. The rest are guesses until it runs.
