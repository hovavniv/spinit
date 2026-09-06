# Security

Deliverable 8. How Spinit authenticates people, decides what they may reach, validates
what they send, protects its keys — and what is still open.

**Status of this document.** Everything in §1–§6 describes code that is merged and running
unless marked otherwise. §7 describes the Spotify integration's authorization layer, which
is **applied to the live database and verified against it** (§7.7); the application code
above it is on `feat/spotify` and not yet merged. §8 describes the guest boundary added by
the live-event slice, applied and verified against the live database. §9 is the honest list
of what is still wrong.

---

## 1. The threat model, stated first

Spinit has three kinds of user and they are not equally trusted:

| Who | Authenticated? | What they can reach | What they must never reach |
|---|---|---|---|
| **DJ** | yes, email + password | their own events and everything hanging off them | any other DJ's events, or even the knowledge that a given event id exists |
| **Couple** (partner) | yes, their own account | the one event they were invited to; their own streaming connection | the DJ's private planning notes; the other couple's anything; their partner's access token |
| **Guest** | **no** — by design | song search, and suggesting/voting at one live event | everything else |

The guest role is the one that shapes the architecture. A wedding guest scans a QR code and
must be able to suggest a song **without an account** — so any endpoint a guest touches is
reachable by anyone on the internet who has the URL, and must be designed on that
assumption. Guests are out of scope for the code merged today, but the search proxy they
will use is already built to that standard (§7.4).

The assets worth protecting, in order:

1. **Another DJ's event data** — the couple's names, venue, date, and their song lists.
2. **A partner's Spotify refresh token** — a long-lived credential for a third-party account.
3. **The DJ's private notes**, which are notes *about* the couple and are frequently
   candid ("Alex's dad wants to do a surprise speech around 9pm").
4. **The service's own API credentials** — Spotify client secret, Last.fm key.
5. **Event ids themselves**, which are capability-like: knowing one is a step toward
   probing it.

---

## 2. Authentication

**Supabase Auth**, email and password, over the `@supabase/ssr` cookie-based session.
Passwords are never seen, stored or transported by application code — the browser posts to
a server action, which hands the credentials to Supabase's own endpoint. There is no
password column anywhere in `public`.

**Sessions live in httpOnly cookies**, set and refreshed by `@supabase/ssr`'s server client.
No token is ever placed in `localStorage` by application code, so an XSS payload cannot read
the session out of storage.

**Email confirmation is on** (`enable_confirmations = true` in `supabase/config.toml`), so an
address must be proven before the account works. `secure_password_change = true` means a
stolen bearer token cannot be turned into a permanent takeover by changing the password.

**Every server action calls `requireUser()` first, before parsing anything.** A server action
is a public HTTP endpoint — it can be invoked without ever loading the page that renders it —
so the page's gate is not the action's gate. `requireUser()` reads the session via
`supabase.auth.getUser()`, which validates the JWT against Supabase rather than trusting the
cookie's contents.

**Error messages do not distinguish failure modes.** A failed login returns
*"Email or password is incorrect"* whether the address is unknown or the password is wrong.
`src/lib/auth/errors.ts` maps every Supabase error to a generic string and logs the detail
server-side; no raw provider text, internal URL, stack trace or submitted input reaches the
client.

**What is missing:** Google OAuth. The original design offered it as the compliant path with
password auth as a secondary option. It is deferred (issue #2), so today password auth is the
*only* method — see §9.1, which is the most significant open item in this document.

---

## 3. Authorization — Row Level Security is the control

The decision that shapes everything: **authorization lives in the database, not in
application code.**

Every table in `public` has RLS enabled and a policy per verb. `src/lib/auth/dal.ts` records
the reasoning: *RLS holds even when application code is wrong.* A DAL that forgets a `where`
clause returns nothing rather than everything.

### 3.1 The ownership predicate

Live policies, one per verb per table:

```sql
create policy "dj selects own events" on public.events
  for select using (dj_id = (select auth.uid()));
```

`(select auth.uid())` rather than bare `auth.uid()` so Postgres evaluates it once per
statement rather than once per row — a performance decision, but it appears here because it
is easy to "tidy" away.

The same predicate, expressed as a subquery, protects the child tables:

```sql
create policy "dj selects must-plays of own events" on public.event_must_play
  for select using (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
  );
```

Neither child table carries its own `dj_id`. Ownership is **derived** rather than
denormalised, so it cannot drift out of sync with the event's.

### 3.2 Three subtleties that are easy to get wrong

**`with check` as well as `using` on every UPDATE.** `using` decides which rows you may
touch; `with check` decides what they may become. Without the second half, a DJ could
re-parent one of their own rows onto another DJ's event: `using` admits the row they own,
and nothing then examines the new `event_id`.

**DELETE filters, it does not raise.** Postgres rejects `for delete ... with check` outright,
and a delete policy that excludes a row makes the statement affect **zero rows and return no
error**. Another DJ's delete silently does nothing. That is the correct outcome, but it means
"the call succeeded" never means "the row was deleted" — the integration tests assert the
affected-row count, not the absence of an error.

**A policy that admits no rows is indistinguishable from success.** This is the single most
recurrent bug in this project — it has appeared three times in different disguises, and §9.5
records why.

### 3.3 Column-level grants, where RLS cannot reach

RLS is per-row and cannot restrict *columns*. Where a column needed protecting, the grant
does it:

```sql
revoke update on public.profiles from authenticated;
grant  update (business_name, phone) on public.profiles to authenticated;
```

A user may edit their business name and phone; they may not edit `id`, `role`, or anything
else added later. This pattern is reused in the Spotify work (§7.2) and is the answer
whenever "a policy protects this column" is proposed — it does not.

### 3.4 Revoking the hosted default

The hosted Supabase project's default ACL grants `anon` and `authenticated` `Dxtm` on every
table created in `public`. `D` is **TRUNCATE**, and **TRUNCATE bypasses RLS entirely.**

No application path can emit one — PostgREST has no TRUNCATE verb — so this is defence in
depth. Every migration nonetheless carries:

```sql
revoke truncate, references, trigger, maintain on <tables> from anon, authenticated;
revoke all on <table> from anon;
```

`anon` holds nothing on any application table. The anonymous role exists only to reach
Supabase's auth endpoints.

### 3.5 404, never 403

`/events/[id]` returns `notFound()` for an event that does not exist **and** for one owned
by another DJ. The two are deliberately indistinguishable.

A 403 would confirm the id is real, turning the route into an oracle for enumerating event
ids — a slow one, since they are UUIDv4, but an oracle nonetheless. The same rule applies to
the partner-claim function (§7.2), which raises the identical error for "no such event",
"already claimed" and "not your invitation".

---

## 4. Input validation

**Zod at every boundary**, in `src/lib/validation.ts`, and the schemas are shared between
the client form and the server action so the two cannot disagree.

Validation happens **after** `requireUser()` and **before** anything reaches the database.
The ordering matters: an unauthenticated caller is refused before their input is even
parsed.

Three layers, deliberately overlapping:

| Layer | Catches | Example |
|---|---|---|
| Zod | shape, length, format | a 201-character venue |
| Postgres `check` | the same rules, as the last word | `check (char_length(venue) between 1 and 120)` |
| Postgres type | structural impossibility | a non-uuid `event_id` |

The check constraints are not redundant with Zod. Zod protects the form; the constraint
protects the *database*, including against a client that skips the form entirely and PATCHes
PostgREST directly — which any authenticated user can do, because PostgREST is a public HTTP
API.

**UUIDs are shape-checked before they reach Postgres.** `isUuid()` guards `/events/[id]`, so
a non-uuid path segment 404s rather than reaching the database and failing with
`22P02 invalid input syntax for type uuid` logged as though it were a genuine failure.

**Output encoding** is React's, which escapes interpolated values by default. `dangerouslySetInnerHTML`
appears exactly once in the codebase, for a server-generated QR code SVG — see §8.8 for why that one
case is safe and deliberate rather than a lapse of this rule.

---

## 5. Secrets and API keys

| Secret | Where | Reaches the browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | env, public by design | yes — it is a public endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | env, public by design | yes — RLS is what makes this safe |
| `SPOTIFY_CLIENT_SECRET` | env, server only | **never** |
| `SPOTIFY_TOKEN_KEY` | env, server only | **never** |
| `LASTFM_API_KEY` | env, server only | **never** |
| `SUPABASE_SERVICE_ROLE_KEY` | env, server only, §7.5 | **never** |

The anon key is *meant* to be public. It identifies the project, not the user; it grants
exactly what RLS permits for the `anon` role, which on this project is nothing. Shipping it
to the browser is the intended design, and it is safe **only because** §3.4 revoked the
default grants.

The rest are server-only and carry no `NEXT_PUBLIC_` prefix, which is the mechanism Next
uses to decide what is inlined into the client bundle. Anything without that prefix is
unavailable to browser code at build time — a compile-time guarantee, not a convention.

`.env.local` is gitignored. `.env.example` carries the key **names** with empty values, so a
fresh clone knows what to set without any value ever entering git history.

**No secret has passed through an agent transcript.** `SPOTIFY_TOKEN_KEY` was generated by
running `openssl rand -base64 32` locally and appended directly to `.env.local`; the client
secret was copied from Spotify's dashboard the same way. This was deliberate and is worth
stating, because an AI-assisted project has an obvious failure mode here.

---

## 6. Protecting server-side calls

**Server Components and server actions do the data access.** The browser never holds a
Supabase client with elevated rights, and never calls Spotify directly.

**`src/lib/supabase/server.ts`** creates the request-scoped client from the session cookie.
Every DAL module carries `import 'server-only'`, which makes importing it from a Client
Component a **build error** rather than a runtime leak.

That import is why `src/lib/events/detailTypes.ts` exists separately from `detailDal.ts`:
the list components are Client Components and need the row *types*, but must not pull in the
module that talks to the database. Splitting the types out is a security boundary, not a
tidiness preference.

**`revalidatePath()` uses the literal path**, never the `'/events/[id]'` pattern. Given a
dynamic pattern with no `type` argument, Next builds a tag matching nothing, warns to the
dev console, and returns normally — the write lands, the screen does not update, and nothing
fails. Not a vulnerability, but a silent-failure class worth naming.

---

## 7. The Spotify integration (designed; on `feat/spotify`, not merged)

This is the newest and most adversarially-reviewed part of the project. Four independent
fresh-context reviews found roughly fifty defects across five revisions of the design; the
security-relevant ones are described here with what they taught.

### 7.1 OAuth

**Authorization Code flow**, not implicit (deprecated) and not PKCE (this app has a server,
so it can hold a secret). The token exchange happens in a route handler with the client
secret in an `Authorization: Basic` header; the secret never leaves the server.

**CSRF protection** via a `state` parameter stored in an httpOnly, SameSite cookie and
compared on the callback. A mismatch aborts before any token is requested.

**Least privilege: one scope.** `user-top-read` and nothing else. The taste report is built
entirely from `GET /me/top/artists`, so requesting `user-library-read`,
`playlist-read-private`, `user-follow-read` or `user-read-recently-played` would ask the
couple to grant access the product never uses. The manual diagnostic scripts request a
second scope and are labelled as diagnostics precisely so the difference does not read as an
oversight.

**Redirect URIs are exact-match and HTTPS-only**, except loopback. Local development uses
`http://127.0.0.1:3000/...` — Spotify removed `localhost` aliases on 2025-11-27.

### 7.2 Linking a partner to an event, and the hole that taught us the pattern

A partner must be linked to `event_partners.user_id` to gain access. The obvious
implementation is an RLS policy letting a user claim an unclaimed row — and it is
**unfixable as a policy**. A user claiming a slot is not yet a partner, so no event-scoped
predicate can admit them; the only workable predicate is `user_id is null`, which lets *any*
signed-in account claim *every* unclaimed slot in the database with one request.

The design specified exactly that, and a review caught it. The replacement is a
`security definer` function that writes one column on one row, only where the invitation
matches **the caller's own verified account email**:

```sql
update public.event_partners set user_id = (select auth.uid())
 where event_id = p_event and slot = p_slot and user_id is null
   and lower(invite_email) = v_email
```

**And the column is writable by no PostgREST role at all** — the grant lists both verbs
explicitly. This is the part worth dwelling on: *no policy could have achieved it.* RLS is
per-row; the column had to be closed by grant.

```sql
grant insert (event_id, slot, display_name, invite_email) on public.event_partners to authenticated;
grant update (slot, display_name, invite_email)           on public.event_partners to authenticated;
```

`user_id` appears in neither. That took two attempts: the first fix column-scoped UPDATE and
left INSERT at table level, so a DJ could still `POST` a row with an arbitrary `user_id`.

The evidence is one query, which is why this is the example worth showing:

```sql
select grantee, privilege_type, column_name
  from information_schema.column_privileges
 where table_name = 'event_partners';
```

Live result: `user_id` appears under **SELECT only**. It is absent from INSERT and from
UPDATE. A reviewer does not have to read the policies to check this control — they read one
table.

### 7.3 Token storage

Refresh tokens live in their own table, `spotify_tokens`, with a policy admitting **only the
owning partner** — not the DJ, not the other partner. They are in a separate table rather
than a column on `spotify_connections` because RLS is per-row: a token beside a status the
other partner is allowed to read would be readable by them too.

Tokens are encrypted **in the application** with AES-256-GCM before reaching Postgres, in a
versioned format (`v1.<iv>.<tag>.<ciphertext>`) so the key can be rotated. A database dump
alone does not yield usable tokens.

Access tokens are never stored — they last an hour and are fetched on demand.

A trigger deletes the token, connection and profile when a partner's account is deleted.
Without it, `on delete set null` on `user_id` would leave a token row reachable by nobody: a
live third-party credential that no application path could revoke or purge.

### 7.4 The search proxy

Guests will search Spotify without an account, so the proxy is built for an untrusted
caller: it is a GET route handler that validates its query with Zod, uses an
**app-level token** (client credentials — no user, no user data reachable), caps results,
and returns a trimmed shape rather than Spotify's raw response.

Today it requires a session. That gate is honestly **necessary but not sufficient** — signup
is open, so it turns "anyone can hammer this" into "anyone willing to register can." A
per-user rate limit is not built (§9.4).

### 7.5 The elevated key this project does not have, and why it nearly did

This is the design decision I would most want to be asked about.

The genre cache is a **control input** — the decision engine reads it to decide whether a
suggested song violates a genre ban. Two successive designs left it writable by any
registered account: first as a table grant, then, after that was "fixed", as a
`security definer` function granted to `authenticated`, which PostgREST exposes at
`POST /rest/v1/rpc/…` and which took the genres **from the caller**. The hole had moved, not
closed, and the design carried a comment asserting otherwise.

The fix I proposed was a **service-role key** for those writes. It would have worked. It was
also the wrong answer, and the argument I built for it is worth reproducing because the flaw
in it is instructive:

> The cache is global, so per-artist enrichment cost is paid **once across the whole
> project** rather than once per couple. Scoping it down would make every couple re-pay for
> artists already resolved. A single narrow privileged path is the smaller cost.

That reasoning is sound for a product with many couples. **This product is capped at five
Spotify users, ever** — development mode, with extended quota unreachable (§7.1). Two
couples, realistically. There was almost no cross-couple sharing to protect. I had priced
the architecture for a user base Spotify does not permit, and then used that price to
justify an elevated credential.

**What was built instead:** the cache is scoped **per event**. Event scope rather than per
partner is deliberate — the two partners of one couple genuinely overlap on top artists, so
the sharing that matters is kept; the DJ can read it, which the genre-ban check needs; and
the blast radius of a bad row is one wedding, written by one of its own participants. Self
harm, not a control input for strangers.

The second write that seemed to need elevation — a recompute that silently wrote zero rows
when the DJ polled — needed only that the poll be authorized to the **owning partner**, so
it always runs under the session that owns the row. Narrower than a key, and it makes the
enrichment flow read correctly: the couple's own connection is enriched by the couple.

So this project holds **no service-role key**, a claim it makes in `CLAUDE.md` and in three
RLS test-file headers, and that claim is still true. An HMAC-signed payload verified by
`pgcrypto` would also have worked and is recorded as considered — it is more machinery than
the problem needs.

**The process point matters more than the outcome.** The decision was reversed because
someone asked "is it a must, or is it what you preferred?" — and those were different
claims that I had presented as one. Nothing was built yet, so reversing cost nothing. The
lesson I would carry: when a design asks for a privileged credential, the question to ask
first is not "is this safe" but "what exactly forces it".

### 7.6 A control that is correct and still produces a wrong number

`past_events_with_counts` is `security_invoker = on`, so widening `events` SELECT propagated
into it: a partner on an **ended** event — `status = 'completed'`, or an `upcoming` event
whose `event_date` has already passed — now sees that row, with `songs_played` always 0 —
because `played_songs` was deliberately *not* widened, so the left join is filtered to
nothing.

Nothing leaks. The recap stays closed, which is the correct outcome. But the count reads
zero rather than being absent, which looks like a bug and is instead two correct controls
meeting. It is unreachable through the interface today — partners only reach
`/events/[id]` — and it is recorded rather than patched, because fixing it means deciding
whether a partner may see `played_songs` at all, which is a product question and not a
schema one.

Worth stating because it is the honest shape of layered authorization: the layers do not
always compose into something that *looks* right.

### 7.7 What is verified, and how

The authorization layer described in §7.1–§7.6 is not a design on paper. Before it was
applied, the migration was run against a **local replica** — a stubbed `auth` schema, all six
prior migrations in order, and live-shaped data — and every control was exercised, not
inspected. It was then applied to the live project and re-verified there.

| Control | Live result |
|---|---|
| RLS enabled on all eight new tables | 8/8 |
| `user_id` writable on either verb | never — SELECT only |
| `artist_genres` write grants to `authenticated` | 0, table **and** RPC |
| `upsert_artist_genres` grantees | `service_role` only |
| Definer functions with empty `search_path` | 4/4 |
| `anon` grants on the new tables | 0 |
| Superseded policies left behind | 0 |
| `events` INSERT/UPDATE policies | untouched; no DELETE policy exists |

Seven escalation attempts were run and all seven were refused: a DJ patching `user_id`; a DJ
inserting an explicit `user_id`; `authenticated` writing `artist_genres` directly;
`authenticated` calling the RPC; a partner re-pointing her token row at her partner's;
`authenticated` inserting into the enrichment queue; `anon` reading anything.

Two further behaviours were proven rather than assumed, because both were open questions:
the purge trigger **does** fire on the foreign key's `on delete set null`, and two concurrent
slot claims produce exactly one winner — the loser's row lock re-evaluates the predicate,
updates zero rows and raises `42501`.

**A note on trusting this table.** Two of the first test attempts passed for the wrong
reasons — one "refused" result was actually the event id resolving to `NULL` because RLS
correctly hid the row from a user who was not yet a partner, so the test was reading its own
fixture through the policy it was testing. The numbers above are post-correction. A green
result that cannot be explained is not evidence.

### 7.8 Verifying the boundary, not the fix

The most useful thing learned across four reviews was about **testing**, not about policies.

Three times, a real hole was found, correctly fixed, and pinned by a test — and the next
review found the same hole on an adjacent surface. UPDATE fixed, INSERT open. Table grant
fixed, routine grant open. The tests passed each time, because each pinned only the case
already known.

So the assertions are now written **per capability, not per verb**:

> No `authenticated` path writes `artist_genres` — enumerated from **both**
> `information_schema.role_table_grants` **and** `information_schema.role_routine_grants`.

That single assertion would have caught the defect that two verb-shaped assertions missed.
The same rule produces one test covering direct table writes and RPC writes together;
splitting them is how one gets fixed and the other does not.

---

## 8. The guest boundary

A guest has no account. They scan a QR code, type a name, and suggest songs. That makes this the
only part of the product an unauthenticated stranger can reach, and it is where most of the
security thinking in this project went.

### 8.1 The problem RLS cannot solve on its own

Row Level Security is this app's authorization control (§3), and every policy in it is shaped
`auth.uid() = <owner>`. **A guest has no `auth.uid()`.** There is no predicate that distinguishes
"a guest who scanned this event's QR code" from "the internet", so RLS has nothing to key on.

The two obvious ways out were both rejected:

- **Grant `anon` insert on the guest tables** and write permissive policies. That is a door anyone
  can walk through: the publishable key ships in the browser bundle, so a caller can `POST` to
  PostgREST directly and insert a thousand suggestions on any event whose id they can guess. The
  three-songs-per-guest cap would become a UI suggestion.
- **Use the service-role key** in the guest server actions. That places a credential which bypasses
  RLS entirely into the request path of the one route unauthenticated people can reach. §7.5
  records why this project does not hold that key at all.

### 8.2 What was built instead: six functions, and nothing else

**`anon` holds no table grants whatsoever.** It holds `execute` on exactly six
`security definer` functions, verified directly against the live database's `pg_proc.proacl`
rather than assumed from the migration source:

| Function | Purpose |
|---|---|
| `guest_event(token)` | Couple's name + is-it-live, for the landing screen. The only one that does not require a live event |
| `guest_join(token, name)` | Mints a session, returns its id |
| `guest_suggest(session, track, title, artist)` | Suggest, or vote if the track is already up |
| `guest_vote(session, suggestion)` | Back someone else's suggestion |
| `guest_queue(session)` | The guest's view of the queue |
| `guest_search_allow(session)` | The per-session search budget |

**That count is the definition of the guest attack surface**, which is why it is stated as a number
rather than implied by a list. It went from five to six during design: `guest_event` was added
because the landing screen renders the couple's name and a live/ended state *before any session
exists*, and nothing in the other five could supply that. It is recorded as a deliberate widening
rather than allowed to drift, and it is the narrowest function of the six — two return values, and
reachable only by someone holding a printed token.

`security definer` means these run as their owner and bypass RLS. That is the point: it is how an
unauthenticated caller performs a bounded, checked write. It also means **every guard has to be
inside the function body**, and that `revoke all on function … from public` must precede each
grant — Postgres grants `execute` to `PUBLIC` by default, so a function merely *not granted* to
`anon` is still callable by `anon`. That one line is the difference between a boundary and a
decoration, and a test asserts it rather than a comment claiming it. The two DJ-only play
functions (`dj_play_suggestion`, `dj_play_pick`) carry the same revoke-then-grant treatment in the
other direction — their live `proacl` shows `postgres` and `authenticated` only, no `anon` and no
bare `PUBLIC` entry.

### 8.3 The trust rule: a guest's arguments are never trusted for anything that matters

The first design had `guest_suggest` accept the artist name and artist id from the caller. A review
found the hole: since the anon key is public, a caller could supply a real track with a **fabricated
artist**, and the couple's do-not-play artist and genre checks would then match against the
fabrication and never fire. The product removes free-text song requests in the UI for exactly this
reason; accepting a caller-supplied artist in the function reopened the same door one layer down.

**The rule now: the only thing a guest supplies that anything trusts is a Spotify track id.**

- `title` and `artist` on a suggestion are stored as **untrusted display text**. They render, and
  nothing matches on them — not the blocklist, not the must-play list, not the artist-repeat rule,
  not the recap.
- Every ranking and blocklist decision keys on ids resolved by **the DJ's own server**, which is
  authenticated and holds the grants, into a `spotify_tracks` / `spotify_track_artists` cache
  `anon` cannot write.

What a hostile caller gains is therefore a row that *looks* wrong in the DJ's queue, and nothing
that affects ranking or the do-not-play list: those match on ids resolved server-side, never on the
caller's text. **The fabrication's consequences were removed rather than the input policed** — for
ranking and blocking. The recap guarantee is narrower, and an earlier draft of this section stated
it as absolute. That was imprecise and is corrected here rather than left standing.

**Corrected: a hostile caller CAN influence what the couple's recap records, for one specific,
bounded case.** `dj_play_suggestion` writes `coalesce(v_resolved_title, v_suggestion_title)` (and
the same for `artist`) — so for a suggestion whose track never resolved against Spotify, the
guest's own unverified text is what lands in the couple's permanent keepsake, up to 200 characters
(`song_suggestions`' own length check). Before a fix to the DJ's poll (below), this window was
effectively unbounded for a crafted, nonexistent-but-shape-valid track id: such an id 404s against
Spotify forever, was silently dropped by the resolver, and was retried on every poll for ever
without ever getting a `spotify_tracks` row. That is fixed: a 404 is now recorded with a sentinel
row rather than retried indefinitely, so a `spotify_tracks` row (real or a sentinel marking the id
unresolvable) always eventually exists, and the unresolved window narrows
to: a track that is played by the DJ before any poll has resolved it, or a track that is a genuine
404 on Spotify's catalogue played anyway. Both are narrow in practice — the DJ approves every song
before it plays, and a queue row that never resolves is visibly flagged (`unresolvable`) rather
than looking like an ordinary pending song — but neither is impossible, and the guarantee below is
stated at the size it actually has, not the one an earlier draft claimed.

**One more correction, this time strictly in the guarantee's favor: for the second case above, the
guest's text no longer lands either.** Once a track id has resolved as a 404, its `spotify_tracks`
row carries the sentinel title (`Unavailable track` / `—`), not a null. `dj_play_suggestion`'s
`coalesce` then finds a non-null `v_resolved_title` and writes the sentinel — the coalesce falls
through to the guest's own text only when the row is genuinely absent, i.e. only in the first case
(played before any poll ran the resolver at all). This is deliberate, not a gap left standing: an
honest sentinel recording "the DJ played something whose id doesn't resolve on Spotify" is strictly
better in a permanent keepsake than trusting an attacker-controlled string, which is the exact
fabrication §8.3's trust rule exists to keep out. The real cost, stated plainly: a track that 404s
*after* being picked from genuine search results (removed from Spotify, market relinking) loses its
real title in the recap along with the fabricated ones — rare, and the alternative is trusting text
the design does not trust.

### 8.4 Abuse limits that are enforced, and by what

| Rule | Enforced by |
|---|---|
| At most 3 songs suggested per guest | A count inside `guest_suggest`, under an advisory lock taken as its first statement — without the lock it is a check-then-insert race |
| Suggesting a song already up votes for it instead | `unique (event_id, spotify_track_id)`, a **database constraint**, so the rule holds under concurrency rather than only in the happy path |
| One vote per guest per song | `primary key (suggestion_id, guest_id)` — a double-tap is a no-op by construction |
| A vote cannot cross events | An explicit check in `guest_vote`; a uuid being unguessable is not an authorization control |
| A token is inert unless the event is live | `status = 'live'` in five of the six functions |
| Search is capped per session | `guest_search_allow`, a counter on the session row |

The session id lives in an `httpOnly` cookie scoped to `/join`, keyed on the token so a guest at two
weddings in one weekend has two independent sessions. It is a bearer token, so no client script has
any reason to read it.

### 8.5 What this does NOT prevent — stated plainly

**Clearing cookies yields a fresh session and three more suggestions.** The cap is per session row
and nothing ties a session to a person. A determined guest can suggest as many songs as they have
patience for. The fix is a real guest list, where each invited person gets their own row; it was
considered and set aside for this slice.

**Nothing bounds session-minting, and therefore nothing bounds votes.** An earlier draft of this
document claimed the three-song cap bounded the blast radius of minting sessions in a loop. **That
was false and is retracted here rather than quietly corrected.** The cap bounds *suggestions*;
**votes are unlimited by design**, and votes are the base term of the ranking and the number the
DJ's screen leads with. So a token-holder can drive any song to rank 1 at no cost. The same gap
defeats the 60-search budget, because that ceiling is per session and sessions are free — leaving
calls to the Spotify app token *shared by every event in this project* bounded only by patience.
A per-event session ceiling is the honest fix and **is not built**.

What makes this tolerable rather than fatal: the attacker must already hold the token — be at the
wedding, or have been given the link — and **the DJ approves every song before it plays**. The worst
outcome is a misleading ranking, never a song on the floor.

**Anyone who obtains the token can join.** A QR code on a table is a shared secret by construction.
It is why the token only works while the event is live.

### 8.6 The do-not-play list is exact on songs and artists, best-effort on genres

Song and artist blocks match on Spotify ids and fire the moment a track is resolved. **Genre blocks
depend on enrichment that lags the queue** — genres come from MusicBrainz and Last.fm, one artist
per request, so a freshly-suggested artist ranks without its genre check until enrichment catches
up. The row carries a visible "genre check pending" reason rather than failing silently, but **a
song can reach the floor before its genre was ever checked.** That distinction belongs to the couple
before it belongs to a document.

### 8.7 Two deliberate decisions that widen access

**A linked partner can read `join_token`.** RLS has no column granularity, and the `events` select
policy admits `dj_id = auth.uid() OR is_event_partner(id)`. The partners are the couple — if anyone
besides the DJ should be able to hand a guest the link, it is them. The alternative (column-level
grants enumerating every other column) breaks silently the next time a column is added.

**`getEventRecap` reads under RLS alone.** Its application-level `dj_id` filter was removed, because
a participant check cannot be expressed as a column filter and the couple must be able to read their
own recap. The `dj or partner selects event` policy is now the only control on that read. The two
failure directions differ and both are worth knowing: a regression in `played_songs`' policy
**hides** songs; a regression in `events`' policy **exposes** a recap.

### 8.8 A server-generated SVG is rendered via `dangerouslySetInnerHTML` — the one exception to §4's rule

§4 states this app avoids `dangerouslySetInnerHTML` entirely; the guest QR modal is a deliberate,
narrow exception, not a lapse. The SVG markup comes from this app's own `qrcode` library, run
server-side against a URL this app fully controls (a shape-checked 22-character token appended to
`siteUrl()`, never a request header — see §7's parallel reasoning for why a forged `Host` must not
influence a URL this app generates), never from guest-supplied or third-party input. It is the only
`dangerouslySetInnerHTML` call in the codebase, and a code comment on both call sites says so.

A related, non-security defect was caught and fixed before merge: an event whose `join_token` was
somehow null would have silently produced a broken join URL and rendered a QR code for it — a dead
link with no signal anywhere on the DJ's screen, discoverable only by a guest scanning a printed
card at the actual event. Fixed by never generating a QR for a URL known to be malformed, logging
the anomaly instead. Recorded here because it is a case where a security-adjacent habit (never
trust a value you have not checked) caught a pure correctness bug that had nothing to do with an
attacker.

### 8.9 What is verified, and what is only shape-checked

Every migration in this slice was applied to a throwaway PostgreSQL 17 before being pushed — which
caught a `CHECK` constraint containing a subquery that does not compile, and a `max(position) + 1`
that returns NULL on an event's first song. **That harness has two blind spots and they are named
here rather than glossed:** its stub `auth.uid()` returns null, so it proves no RLS *behaviour*; and
it never runs PostgREST, so it cannot see an ambiguous embed (one shipped for a day behind a green
test suite, until a real HTTP call against the live database surfaced it as a 500).

**The six guest functions are the exception and were genuinely proven locally**, as `anon`, via
`set role anon` — because they take the session id as an argument and never call `auth.uid()`.

**RLS behaviour is verified by the integration suite against the live project**, using real
accounts: a partner can read their event's played songs, a partner on another event cannot, and a
partner cannot insert, update or delete one. The negative cases are what pin the policy to
`for select` — a test proving only that a partner can read would pass just as well against a much
wider `for all` grant.

The guest functions were additionally reviewed by a fresh adversarial pass before being pushed,
which found one real defect: `btrim` strips only ASCII space, so a display name of tabs or newlines
passed the length guard and would have rendered blank on the DJ's screen and in the couple's
permanent recap. Fixed before deployment, and the deployed function was verified to be the fixed one
via `pg_get_functiondef` rather than by assuming the push carried it.

---

## 9. Remaining risks

Honest, and ordered by how much they matter.

### 9.1 Email and password is the only auth method

Secure-coding rule 1 prohibits password auth; Google OAuth was to be the compliant path.
It is deferred (issue #2) and `signInWithGoogle` does not exist. **Today there is no
compliant alternative offered at all**, which is materially worse than the original design
intended. Open until issue #2 ships.

### 9.2 A copied session cookie outlives sign-out

`signOut()` revokes the refresh token and clears cookies, but an already-issued access JWT
is stateless and stays valid until it expires — one hour by default. `secure_password_change`
stops it becoming a permanent takeover; the one-hour read window is unclosed. `jwt_expiry` is
the only lever available on the free tier. Idle timeout is a Pro-plan feature.

### 9.3 No session expiry or idle timeout

`enable_refresh_token_rotation` is on with no `timebox` or `inactivity_timeout`, so a session
can live indefinitely while it keeps refreshing. Gated to Pro plans; unfixable as scoped.

### 9.4 No application-level rate limiting

Beyond Supabase Auth's per-IP limits, nothing throttles login, registration or the search
proxy. Signup is open, so an account is a thirty-second obstacle. The fix is a shared-store
limiter (Upstash Redis or similar) in front of the auth actions and the proxy.

### 9.5 The silent zero-row write is a recurring class, not a fixed bug

A policy that admits no rows **filters** — it returns success having written nothing. So does
an `UPDATE` against a row that does not exist. This has appeared three times: in RLS, in a
missing backfill row, and in a route writing a table it lacked rights to.

Mitigated structurally rather than case by case: writes to the new tables **upsert** rather
than update, backfills cover every row rather than the non-null ones, and the integration
tests assert affected-row counts rather than the absence of an error. It is listed here
because the *class* is still live wherever someone writes a plain `.update()`.

### 9.6 `data.user.identities` enumerates confirmed emails

Readable from Supabase's public signup endpoint, it reveals whether an address is already
confirmed — bypassing this app's own generic error mapper. Not mitigated; it is Supabase's
endpoint, not ours.

### 9.7 The artist cache is never re-fetched

Once resolved, a genre stays cached. `fetched_at` is recorded so a future slice can age rows
out; nothing reads it today. A staleness limit rather than a security one — the write path is
closed (§7.5) — but a wrong genre is permanent.

### 9.8 Built-in SMTP, 2 emails/hour project-wide — and a test defect hiding behind it

Adequate for one controlled demo, fragile otherwise.

**One failing test was attributed to this cap for a day and was only half explained by it.**
The same test also produced `Email address "…@example.com" is invalid` — a validation
rejection, not a quota, because it generates addresses at the RFC 2606 reserved domain,
which Supabase rejects under some configurations. Two distinct failures under one label.
Recorded here as well as in the test plan because the mistake is the interesting part: an
explanation that fits the first observation stops the investigation.
 Also the reason confirmation links are
single-browser and single-signup-at-a-time: template customisation is unavailable on the free
tier, so the flow relies on Supabase's stock link and one fixed PKCE cookie name. Fix: custom
SMTP, which lifts both.

### 9.9 No Content-Security-Policy header

Not set. React's escaping, plus the single, reviewed `dangerouslySetInnerHTML` exception (§8.8)
being fed only server-generated, non-user-controlled markup, are the current XSS defences; a CSP
would be defence in depth.

### 9.10 No password reset

The "Forgot password?" link is inert.

### 9.11 Cross-provider email deduplication is unverified

Signing up with a password and then with Google at one address may produce two identities
depending on Supabase's linking configuration. Not tested; moot until issue #2.

### 9.12 The RLS integration tests are not reproducible from the repo alone

They depend on users registered by hand through the app's own `/register` form against the
hosted project, which couples the suite to the register flow — a signup regression breaks the
RLS tests too. Fix: a local `supabase start` stack seeded from a migration.

### 9.13 Partner chrome is unresolved

A partner opening the event page currently lands inside the DJ's navigation. A presentation
defect rather than a data one — the boundary itself holds — but it must be closed before the
couple's own entry point ships.

### 9.14 Anonymous sign-ins are the better design, and were not taken

Supabase supports anonymous sign-ins: `signInAnonymously()` mints a real user with a real
`auth.uid()` that RLS keys on normally, and this project's `config.toml` already carries
`enable_anonymous_sign_ins = false` — a one-line change. It would replace six hand-written
`security definer` functions with ordinary RLS policies, and its built-in 30-per-hour-per-IP limit
would bound the session-minting gap §8.5 admits is unbounded.

**It was not taken, and the reason is specific rather than schedule.** An anonymous user assumes the
`authenticated` role, so enabling it re-scopes a role every policy in this project depends on —
Supabase's own documentation says to review every policy first. And one concrete consequence was
found before deciding: `on_auth_user_created` fires on *any* `auth.users` insert, so **every guest
would get a `profiles` row**. A 150-guest wedding creates 150 phantom DJ profiles. That is fixable
with a trigger guard, but it is the first consequence anyone happened to look for, and the question
is how many more there are in a table this slice never touched.

Re-auditing roughly twenty policies and adding a trigger guard, the day before submission, with no
review budget left, was the wrong trade against a boundary that has been built, reviewed and tested.
**With more time this is the first thing I would change**, and the audit is the work, not the flag.

### 9.15 Pre-existing functions and Postgres's default `EXECUTE TO PUBLIC`

`purge_partner_connection` and `rls_auto_enable` are both executable by `anon` — verified directly
against the live database's `pg_proc.proacl`, which is `null` for both, meaning neither has ever
had its privileges touched since creation and both still carry Postgres's default grant of
`EXECUTE` to `PUBLIC`. Almost certainly by omission rather than decision, since the guest functions
(§8.2) revoke this same default deliberately.

**Both are inert in effect, by verified mechanism rather than assumption.**
`purge_partner_connection` returns `trigger` and `rls_auto_enable` returns `event_trigger`;
PostgREST exposes neither, and calling either outside its trigger context errors. Nothing is
exposed. But "safe because of what it returns" is a weaker posture than "not granted", and the
revoke-before-grant pattern applied to the guest functions should be applied to these two as well.

**A third function, `is_event_partner`, was checked on the same pass and is NOT in this state.**
An earlier draft of this section named it alongside the two above; live `proacl` shows
`{postgres=X, authenticated=X}` — no `anon` entry — so its default grant has already been revoked
and it is not callable by `anon` today. Recorded as a correction rather than silently dropped: the
draft's claim did not match the database, and the database is what this document is graded on.

### 9.16 The invite handoff routes off user metadata, which the user can write

A partner's route back to their invitation after email confirmation travels two ways, and neither
is authoritative.

The first is the `spinit_invite` cookie, set at signup, which expires after 30 minutes
(`maxAge: 1800`). The PKCE code-verifier cookie `@supabase/ssr` sets at the same moment does not
expire until the browser session ends. A same-browser partner who opens their confirmation email
more than 30 minutes after registering — an ordinary delay, not an edge case — therefore reaches
`/auth/callback` with an exchange that succeeds but no invite cookie. The fallback behind the
cookie could not cover for this and still cannot on its own: `/auth/callback` infers "is a partner"
from an `event_partners` row carrying their `user_id`, and only `claim_partner_slot` writes that
row — *after* confirmation, on a button press. A partner is therefore never detectable as one at
the moment they confirm, so before this fix every such partner landed on the DJ dashboard, which
then asks them for a business name they will never have. Found on a walk-through 2026-09-06 and
fixed by also storing the path on the user's own Supabase metadata (`raw_user_meta_data.invite_path`),
which travels with the account rather than the browser. **This is the bug that was actually
reported and fixed.**

**Confirming on a different device is a separate failure, and this fix does not reach it.**
`@supabase/ssr`'s `createServerClient` hardcodes `flowType: "pkce"` (not overridable via options),
and the PKCE code verifier lives only in a cookie on the device that registered. Opening the
confirmation link on a different device makes `exchangeCodeForSession` itself return
`AuthPKCECodeVerifierMissingError` (code `pkce_code_verifier_not_found`) before the route ever
reaches the metadata fallback — the exchange fails first, so there is no user session to read
metadata off. The route now at least gives this user accurate copy instead of "try signing up
again" (which fails, since the address is already registered, and burns the 2/hour mailer quota) —
see the `SAME_BROWSER_ERROR_CODES` handling in `/auth/callback`. The account is nonetheless
confirmed by this point (GoTrue's `/verify` endpoint confirms before redirecting), so their next
password-login attempt is rescued by the same metadata fallback inside `signInWithPassword`.
**This last claim is unverified** — it has not been tested against a live confirmation email —
and is recorded as such rather than asserted.

**The residual risk is that `user_metadata` is user-writable via `auth.updateUser`.** A signed-in
user can set `invite_path` to any string. Both readers pass it through the same `safeRedirect`
guard as every other untrusted path (§4), which pins it to `/invite/{uuid}/{1|2}` and resolves it
against `SITE_URL`, so it cannot reach another origin. What forging it buys is a redirect to a page
that is already public to read, deliberately (§8.7) — and the claim behind that page still matches
the caller's own confirmed email inside `claim_partner_slot`. So this is a routing hint, not an
authorization input, and the same reasoning already applied to the hidden `mode` and `invitePath`
form fields covers it.

**The better design was not taken, and the reason was schedule, not doubt.** The invitation is a
fact in the database: `event_partners.invite_email` already holds the address the DJ invited. A
`security definer` function returning the unclaimed row whose `lower(invite_email)` matches
`lower(auth.email())` would route off that fact instead of off a hint the account carried, would
need no metadata at all, and would additionally rescue a partner whose account was created without
ever touching the invite link. It needs a migration, and it was declined on the submission date
rather than pushed to the live project hours before grading. It is the honest first item under
§9's heading for this area.

**A partner whose invitation can never be claimed is otherwise trapped on the invite page.** If the
DJ typed the invited email slightly wrong, or the partner's `event_partners` row was deleted or
unlinked, `claim_partner_slot` refuses forever, `user_id` stays null, and `postLoginPath`'s
`!ownsEvents && !isPartner` check sends this account back to `/invite/{eventId}/{slot}` on every
future sign-in — a standalone page with no app navigation. Mitigated by an always-visible link on
that page back to `/dashboard`, present regardless of claim outcome (not only after a failed
attempt), worded for someone who may be in the wrong place.

---

## 10. What I would do next, in order

1. **Audit every RLS policy and enable anonymous sign-ins** (§9.14), replacing six hand-written
   `security definer` functions with ordinary RLS and closing the unbounded-session-minting gap
   (§8.5) with Supabase's own per-IP limit. The largest single improvement available, and the
   reason it isn't done yet is a real audit cost, not a preference for the current design.
2. **Ship Google OAuth** (§9.1). It is the only item that closes a stated rule violation.
3. **Rate-limit the auth actions and the search proxy** (§9.4). Cheap, and it is the
   difference between "signup is a speed bump" and "signup is a control".
4. **Revoke the default `PUBLIC` execute grant on `purge_partner_connection` and
   `rls_auto_enable`** (§9.15). Both are inert today, but "not granted" is a stronger posture
   than "safe because of what it returns", and this is a two-line fix.
5. **Route the invite handoff off `event_partners.invite_email` rather than user metadata**
   (§9.16), replacing a user-writable routing hint with a database fact. Contained — one
   `security definer` function and two call sites.
6. **Custom SMTP** (§9.8), which also unlocks password reset (§9.10) and fixes the
   single-signup confirmation flow.
7. **A local Supabase stack for the test suite** (§9.12), so the security guarantees are
   reproducible by a grader rather than only by me.
8. **A CSP header** (§9.9).

Items 2–4 and 6–7 are each a day or less, and item 4 is minutes. Item 1 is the one real
audit-sized undertaking on this list.
