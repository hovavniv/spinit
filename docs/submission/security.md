# Security

Deliverable 8. How Spinit authenticates people, decides what they may reach, validates
what they send, protects its keys — and what is still open.

**Status of this document.** Everything in §1–§6 describes code that is merged and running
unless marked otherwise. §7 describes the Spotify integration's authorization layer, which
is **applied to the live database and verified against it** (§7.7); the application code
above it is on `feat/spotify` and not yet merged. §8 is the honest list of what is still
wrong.

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
*only* method — see §8.1, which is the most significant open item in this document.

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
recurrent bug in this project — it has appeared three times in different disguises, and §8.5
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

**Output encoding** is React's, which escapes interpolated values by default. There is no
`dangerouslySetInnerHTML` anywhere in the codebase.

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
per-user rate limit is not built (§8.4).

### 7.5 One privileged path, and why it exists

`SUPABASE_SERVICE_ROLE_KEY` is a deliberate departure from this repo's practice — every
prior slice states it never touches that key, and all three RLS test suites say so in their
headers.

It exists because the genre cache is a **control input**: the decision engine reads it to
decide whether a suggested song violates a genre ban. Two successive designs left that cache
writable by any registered account — first as a table grant, then, after that was "fixed",
as a `security definer` function granted to `authenticated`, which PostgREST exposes at
`POST /rest/v1/rpc/…` and which took the genres **from the caller**. The hole had moved, not
closed, and the design carried a comment asserting otherwise.

The resolution: no write grant and no execute grant to `authenticated`. Writes happen in one
server-only module under a service-role client. The constraints are checkable and are in the
definition of done — the key appears in exactly one module, that module is server-only, it
is never imported by a Client Component, and the RLS test suites continue to use the anon key
exclusively so their guarantees are unchanged.

### 7.6 A control that is correct and still produces a wrong number

`past_events_with_counts` is `security_invoker = on`, so widening `events` SELECT propagated
into it: a partner on a **completed** event now sees that row, with `songs_played` always 0 —
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

## 8. Remaining risks

Honest, and ordered by how much they matter.

### 8.1 Email and password is the only auth method

Secure-coding rule 1 prohibits password auth; Google OAuth was to be the compliant path.
It is deferred (issue #2) and `signInWithGoogle` does not exist. **Today there is no
compliant alternative offered at all**, which is materially worse than the original design
intended. Open until issue #2 ships.

### 8.2 A copied session cookie outlives sign-out

`signOut()` revokes the refresh token and clears cookies, but an already-issued access JWT
is stateless and stays valid until it expires — one hour by default. `secure_password_change`
stops it becoming a permanent takeover; the one-hour read window is unclosed. `jwt_expiry` is
the only lever available on the free tier. Idle timeout is a Pro-plan feature.

### 8.3 No session expiry or idle timeout

`enable_refresh_token_rotation` is on with no `timebox` or `inactivity_timeout`, so a session
can live indefinitely while it keeps refreshing. Gated to Pro plans; unfixable as scoped.

### 8.4 No application-level rate limiting

Beyond Supabase Auth's per-IP limits, nothing throttles login, registration or the search
proxy. Signup is open, so an account is a thirty-second obstacle. The fix is a shared-store
limiter (Upstash Redis or similar) in front of the auth actions and the proxy.

### 8.5 The silent zero-row write is a recurring class, not a fixed bug

A policy that admits no rows **filters** — it returns success having written nothing. So does
an `UPDATE` against a row that does not exist. This has appeared three times: in RLS, in a
missing backfill row, and in a route writing a table it lacked rights to.

Mitigated structurally rather than case by case: writes to the new tables **upsert** rather
than update, backfills cover every row rather than the non-null ones, and the integration
tests assert affected-row counts rather than the absence of an error. It is listed here
because the *class* is still live wherever someone writes a plain `.update()`.

### 8.6 `data.user.identities` enumerates confirmed emails

Readable from Supabase's public signup endpoint, it reveals whether an address is already
confirmed — bypassing this app's own generic error mapper. Not mitigated; it is Supabase's
endpoint, not ours.

### 8.7 The artist cache is never re-fetched

Once resolved, a genre stays cached. `fetched_at` is recorded so a future slice can age rows
out; nothing reads it today. A staleness limit rather than a security one — the write path is
closed (§7.5) — but a wrong genre is permanent.

### 8.8 Built-in SMTP, 2 emails/hour project-wide

Adequate for one controlled demo, fragile otherwise. Also the reason confirmation links are
single-browser and single-signup-at-a-time: template customisation is unavailable on the free
tier, so the flow relies on Supabase's stock link and one fixed PKCE cookie name. Fix: custom
SMTP, which lifts both.

### 8.9 No Content-Security-Policy header

Not set. React's escaping and the absence of `dangerouslySetInnerHTML` are the current XSS
defences; a CSP would be defence in depth.

### 8.10 No password reset

The "Forgot password?" link is inert.

### 8.11 Cross-provider email deduplication is unverified

Signing up with a password and then with Google at one address may produce two identities
depending on Supabase's linking configuration. Not tested; moot until issue #2.

### 8.12 The RLS integration tests are not reproducible from the repo alone

They depend on users registered by hand through the app's own `/register` form against the
hosted project, which couples the suite to the register flow — a signup regression breaks the
RLS tests too. Fix: a local `supabase start` stack seeded from a migration.

### 8.13 Partner chrome is unresolved

A partner opening the event page currently lands inside the DJ's navigation. A presentation
defect rather than a data one — the boundary itself holds — but it must be closed before the
couple's own entry point ships.

---

## 9. What I would do next, in order

1. **Ship Google OAuth** (§8.1). It is the only item that closes a stated rule violation.
2. **Rate-limit the auth actions and the search proxy** (§8.4). Cheap, and it is the
   difference between "signup is a speed bump" and "signup is a control".
3. **Custom SMTP** (§8.8), which also unlocks password reset (§8.10) and fixes the
   single-signup confirmation flow.
4. **A local Supabase stack for the test suite** (§8.12), so the security guarantees are
   reproducible by a grader rather than only by me.
5. **A CSP header** (§8.9).

The first four are each a day or less. None is blocked by anything but time.
