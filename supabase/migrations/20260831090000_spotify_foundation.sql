-- Spotify integration, plan A: schema and access.
--
-- Design: docs/specs/2026-08-30-spotify-integration-design.md (revision 5)
-- §5.1 tables, §5.3 RLS, §5.4 grants, §2.6 partner linkage, §5.2 notes.
--
-- Must sort AFTER 20260830120000_event_song_lists.sql, which created the
-- events.notes column and the eight "dj ... of own events" policies this
-- migration drops.
--
-- Eight tables, four functions, three triggers. `events` widens SELECT ONLY:
-- its insert and update policies are untouched, so a partner can read an event
-- and edit its song lists without being able to rename it, move its date or
-- cancel it (§2.4).
--
-- Notes leave `events` entirely, which is what makes widening that table's
-- SELECT safe -- there is no longer a column on it a partner may not see.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.spotify_conn_status as enum ('invited', 'connected', 'failed');

-- 'resolved, genuinely no usable genres' and 'lookup failed, retry later' are
-- BOTH an empty genres object and must never be conflated: this cache is
-- permanent, so conflating them lets one MusicBrainz 503 poison an artist
-- forever (§2.10).
create type public.enrichment_status as enum ('pending', 'resolved', 'failed');

-- 'none' is a member. §2.10's terminal rung stores it; revision 4 named it in
-- prose without adding it, which would have raised 22P02 on every artist that
-- walked the full ladder and left it pending forever.
create type public.enrichment_route as enum
  ('mbid', 'alias', 'spotify_name', 'none');

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- user_id is null between "the DJ sent the invite" and "the partner claimed
-- the slot" -- the state the artboard draws as Pending. It is `on delete set
-- null`, not cascade: deleting a user account must not delete a wedding's
-- partner record and everything hanging off it.
create table public.event_partners (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  slot         smallint not null,
  display_name text not null,
  invite_email text not null,
  user_id      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint partner_slot_range check (slot in (1, 2)),
  constraint partner_name_len   check (char_length(display_name) between 1 and 120),
  constraint partner_email_len  check (char_length(invite_email) between 3 and 320),
  unique (event_id, slot)
);

-- Stops one account claiming both slots on the same event.
create unique index event_partners_user_event_idx
  on public.event_partners (event_id, user_id) where user_id is not null;
create index event_partners_user_idx
  on public.event_partners (user_id) where user_id is not null;

create table public.spotify_connections (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null unique
                    references public.event_partners(id) on delete cascade,
  spotify_user_id text,
  scopes          text,
  status          public.spotify_conn_status not null default 'invited',
  last_error      text,
  connected_at    timestamptz,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now()
);

-- Separate table, not a column on spotify_connections. RLS is row-level, so a
-- refresh token living beside the status a partner's partner is allowed to
-- read would be readable by them too. Its own table gets its own policy.
create table public.spotify_tokens (
  partner_id    uuid primary key
                  references public.event_partners(id) on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);

-- The enrichment cache, keyed by the SPOTIFY artist id (§2.13) and GLOBAL, not
-- per-event: two weddings both wanting Ed Sheeran cost one enrichment, ever.
-- That is what makes the per-artist cost tolerable, and also why a bad write
-- here damages every event in the product at once.
create table public.artist_genres (
  spotify_artist_id text primary key
    constraint artist_genres_id_shape check (spotify_artist_id ~ '^[A-Za-z0-9]{22}$'),
  artist_name       text not null,   -- as Spotify gave it
  musicbrainz_name  text,            -- differs by script for Israeli artists
  musicbrainz_id    text,
  genres            jsonb not null default '{}'::jsonb,  -- {"pop": 100, "disco": 72}
  origins           jsonb not null default '{}'::jsonb,  -- {"israeli": 100}
  eras              jsonb not null default '{}'::jsonb,  -- {"80s": 38}
  status            public.enrichment_status not null default 'pending',
  resolved_via      public.enrichment_route,
  attempts          smallint not null default 0,
  last_attempt_at   timestamptz,
  fetched_at        timestamptz,
  constraint artist_genres_name_len check (char_length(artist_name) between 1 and 300),
  constraint artist_genres_mb_len   check (musicbrainz_id is null
                                           or char_length(musicbrainz_id) <= 40),
  constraint artist_genres_size     check (pg_column_size(genres)
                                           + pg_column_size(origins)
                                           + pg_column_size(eras) < 8192)
);

create index artist_genres_retry_idx
  on public.artist_genres (status, last_attempt_at) where status = 'failed';

-- The enrichment work list (§2.11). Progress on the page is two counts over
-- this table, which is why it exists at all: deriving `total` from the merged
-- artist list counted ~150 artists while only 20 are ever enriched, so
-- "analysing" could never clear.
create table public.enrichment_queue (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.event_partners(id) on delete cascade,
  artist_id  text not null,
  position   smallint not null,
  claimed_at timestamptz,
  settled_at timestamptz,
  unique (partner_id, artist_id)
);

create index enrichment_queue_next_idx
  on public.enrichment_queue (partner_id, position) where settled_at is null;

create table public.taste_profiles (
  partner_id     uuid primary key
                   references public.event_partners(id) on delete cascade,
  top_artists    jsonb not null,                      -- phase 1, always present
  genre_weights  jsonb not null default '{}'::jsonb,  -- phase 2
  origin_weights jsonb not null default '{}'::jsonb,
  era_weights    jsonb not null default '{}'::jsonb,
  computed_at    timestamptz not null default now(),
  enriched_at    timestamptz
);

-- BOTH NOTE TABLES ARE ONE-TO-ONE BECAUSE event_id IS THEIR PRIMARY KEY, and
-- that changes how the application reads them. PostgREST detects a to-one
-- relationship when the foreign key is also unique and returns that embed as a
-- JSON OBJECT, not an array; event_partners' FK is not unique, so that embed IS
-- an array. Three embeds in one select, two shapes. Indexing [0] into the
-- object yields undefined, the field renders empty, and the next save writes ''
-- over a real note -- a destroy, not a blank field. See firstRow() in
-- src/lib/events/detailDal.ts.
create table public.event_private_notes (
  event_id   uuid primary key references public.events(id) on delete cascade,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  constraint private_notes_len check (char_length(body) <= 2000)
);

-- No updated_by. Nothing renders it, and §5.4 grants participants table-level
-- update here, so any participant could PATCH it to the other person's uid -- a
-- field asserting who wrote something, which can be forged, is worse than no
-- field, because a reader believes it.
create table public.event_shared_notes (
  event_id   uuid primary key references public.events(id) on delete cascade,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  constraint shared_notes_len check (char_length(body) <= 2000)
);

-- The repo's usual moddatetime trigger, so updated_at is the last edit rather
-- than the backfill time forever.
--
-- extensions.moddatetime, NOT public.moddatetime: 20260829145349_profiles.sql
-- created the extension with `schema extensions`, and both prior migrations
-- that use it qualify it that way. public.moddatetime does not exist and would
-- fail 42883 mid-migration.
create trigger event_private_notes_touch before update on public.event_private_notes
  for each row execute function extensions.moddatetime(updated_at);
create trigger event_shared_notes_touch before update on public.event_shared_notes
  for each row execute function extensions.moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- 3. Row level security ON for every new table
--
-- Not optional and not implied: a policy on a table without RLS enabled is
-- inert, and with the §5.4 grants below these tables would be readable by every
-- signed-in user.
-- ---------------------------------------------------------------------------

alter table public.event_partners      enable row level security;
alter table public.spotify_connections enable row level security;
alter table public.spotify_tokens      enable row level security;
alter table public.artist_genres       enable row level security;
alter table public.enrichment_queue    enable row level security;
alter table public.taste_profiles      enable row level security;
alter table public.event_private_notes enable row level security;
alter table public.event_shared_notes  enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Functions
-- ---------------------------------------------------------------------------

-- The one recursion breaker. event_partners' SELECT policy has to let one
-- partner see the other partner's row; written inline that clause reads
-- event_partners from inside event_partners' own policy, and Postgres applies
-- RLS to subqueries in policy expressions -- infinite recursion. A security
-- definer function bypasses RLS on the table it reads and breaks the cycle.
--
-- `set search_path = ''` with fully-qualified names is mandatory: a definer
-- function without it resolves names against the CALLER's search_path.
--
-- The DJ half is deliberately NOT in here. Postgres does not inline security
-- definer SQL functions, so anything inside one becomes an opaque per-row call
-- and stops using an index. The DJ path is the hot path, so every policy below
-- keeps the DJ clause inline and FIRST, and the partner branch is only reached
-- when the DJ branch is false.
create function public.is_event_partner(e uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.event_partners
     where event_id = e and user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_event_partner(uuid) from public, anon;
grant  execute on function public.is_event_partner(uuid) to authenticated;

-- Partner linkage (§2.6). This is the real production mechanism, not a shim.
--
-- A user claiming a slot is by definition not yet a partner, so no event-scoped
-- policy can admit them, and the only policy that would work (`user_id is
-- null`) lets any signed-in user claim every unclaimed slot in the database
-- with one request. It is not fixable as a policy.
--
-- Writes exactly one column, on exactly one row, only where the invitation was
-- addressed to the CALLER'S OWN VERIFIED ACCOUNT EMAIL. Raises 42501 for every
-- failure, so a caller cannot tell "no such event" from "already claimed" from
-- "not your invitation".
create function public.claim_partner_slot(p_event uuid, p_slot smallint)
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_id    uuid;
  v_email text;
begin
  -- email_confirmed_at is checked HERE rather than relied on from project
  -- settings. Confirmations are currently on, but that is a hosted dashboard
  -- setting outside this repo -- nothing in version control would show it
  -- being turned off. With it off, anyone could sign up as the invitee's
  -- address and claim the slot. One clause makes the control self-contained.
  select lower(u.email) into v_email
    from auth.users u
   where u.id = (select auth.uid())
     and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- The unique_violation arm is not defensive padding. A couple sharing one
  -- email address -- entirely ordinary -- means one address invited to BOTH
  -- slots of one event, and event_partners_user_event_idx then fires on the
  -- second claim BEFORE the `v_id is null` check below. Unwrapped, that
  -- escapes as a raw 23505 whose DETAIL names an internal event_id and
  -- user_id, through a function whose whole contract is that every failure is
  -- indistinguishable.
  begin
    update public.event_partners
       set user_id = (select auth.uid())
     where event_id = p_event
       and slot     = p_slot
       and user_id is null
       and lower(invite_email) = v_email
    returning id into v_id;
  exception when unique_violation then
    raise exception 'no matching invitation' using errcode = '42501';
  end;

  if v_id is null then
    raise exception 'no matching invitation' using errcode = '42501';
  end if;
  return v_id;
end $$;

revoke execute on function public.claim_partner_slot(uuid, smallint)
  from public, anon;
grant execute on function public.claim_partner_slot(uuid, smallint)
  to authenticated;

-- spotify_tokens' only policy is `p.user_id = auth.uid()`, so once user_id goes
-- null the token row becomes readable, writable and deletable BY NOBODY -- an
-- encrypted credential no application path can revoke -- and the slot becomes
-- re-claimable, so the next claimant would inherit the previous person's
-- connection. This closes both.
create function public.purge_partner_connection() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if old.user_id is not null and new.user_id is null then
    delete from public.spotify_tokens      where partner_id = old.id;
    delete from public.spotify_connections where partner_id = old.id;
    delete from public.taste_profiles      where partner_id = old.id;
  end if;
  return new;
end $$;

create trigger event_partners_purge_on_unlink
  before update of user_id on public.event_partners
  for each row execute function public.purge_partner_connection();

-- The ONLY writer of artist_genres, callable only by service_role.
--
-- Revision 4 granted execute to `authenticated` and claimed the hole closed. It
-- was not -- it was relocated: config.toml exposes the public schema, so every
-- function authenticated can execute is reachable at POST /rest/v1/rpc/<name>,
-- and this one takes p_genres FROM THE CALLER. The validation below is defence
-- in depth; the control is that authenticated holds no execute grant at all.
create function public.upsert_artist_genres(
  p_spotify_id text, p_name text, p_mb_id text, p_mb_name text,
  p_genres jsonb, p_origins jsonb, p_eras jsonb,
  p_status public.enrichment_status, p_via public.enrichment_route
) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if p_spotify_id !~ '^[A-Za-z0-9]{22}$' then
    raise exception 'bad spotify id' using errcode = '22023';
  end if;
  insert into public.artist_genres as a (
    spotify_artist_id, artist_name, musicbrainz_id, musicbrainz_name,
    genres, origins, eras, status, resolved_via,
    attempts, last_attempt_at, fetched_at)
  values (p_spotify_id, p_name, p_mb_id, p_mb_name,
          coalesce(p_genres,'{}'::jsonb), coalesce(p_origins,'{}'::jsonb),
          coalesce(p_eras,'{}'::jsonb), p_status, p_via, 1, now(),
          case when p_status = 'resolved' then now() end)
  -- ONLY A RESOLVED ATTEMPT MAY REPLACE THE FACETS.
  --
  -- Revision 5 wrote these as unconditional excluded.*, which meant a later
  -- `failed` write erased good genres to {} and nulled resolved_via, from a
  -- PERMANENT GLOBAL cache. Reachable on the common path: enrichment_queue is
  -- unique per (partner_id, artist_id), so both partners of one couple queue
  -- the same shared artist, the claim query never consults artist_genres.status,
  -- and the second partner's poll re-runs the ladder. One MusicBrainz 503
  -- during that run and the artist is {} for every event in the product.
  --
  -- The status column stopped the two states being CONFLATED. It did not stop
  -- the poisoning, because the write destroyed the row on its way to setting
  -- the flag.
  on conflict (spotify_artist_id) do update set
    artist_name      = excluded.artist_name,
    -- The MBID and alias are stable and cached independently of the tags, so a
    -- Last.fm miss does not force re-resolving them (§2.10).
    musicbrainz_id   = coalesce(excluded.musicbrainz_id, a.musicbrainz_id),
    musicbrainz_name = coalesce(excluded.musicbrainz_name, a.musicbrainz_name),
    genres       = case when excluded.status = 'resolved'
                        then excluded.genres       else a.genres       end,
    origins      = case when excluded.status = 'resolved'
                        then excluded.origins      else a.origins      end,
    eras         = case when excluded.status = 'resolved'
                        then excluded.eras         else a.eras         end,
    resolved_via = case when excluded.status = 'resolved'
                        then excluded.resolved_via else a.resolved_via end,
    -- A resolved row stays resolved when a later attempt fails: we still hold
    -- good tags and there is nothing to retry. Flipping it back would put it in
    -- artist_genres_retry_idx and re-enrich a known artist forever, once per
    -- partner who likes them.
    status       = case when a.status = 'resolved' and excluded.status <> 'resolved'
                        then a.status else excluded.status end,
    -- Increment only on a non-resolved outcome. Counting successes would give a
    -- row re-resolved cleanly by five partners attempts=5 and a long backoff it
    -- never earned.
    attempts     = case when excluded.status = 'resolved'
                        then a.attempts else a.attempts + 1 end,
    last_attempt_at = now(),
    fetched_at   = case when excluded.status = 'resolved' then now()
                        else a.fetched_at end;
end $$;

revoke execute on function public.upsert_artist_genres
  from public, anon, authenticated;
grant execute on function public.upsert_artist_genres to service_role;

-- ---------------------------------------------------------------------------
-- 5. Policies
-- ---------------------------------------------------------------------------

-- events: SELECT widens, everything else is untouched. There is no DELETE
-- policy to touch -- 20260829171500_events.sql says so outright.
drop policy "dj selects own events" on public.events;
create policy "dj or partner selects event" on public.events
  for select using (
    dj_id = (select auth.uid()) or public.is_event_partner(id)
  );

-- The eight existing "dj ... of own events" policies are DROPPED, not left
-- beside the new ones. Permissive policies OR together so behaviour would be
-- correct either way, but leaving them gives 16 policies where 8 belong.
drop policy "dj selects must-plays of own events"   on public.event_must_play;
drop policy "dj inserts must-plays into own events" on public.event_must_play;
drop policy "dj updates must-plays of own events"   on public.event_must_play;
drop policy "dj deletes must-plays of own events"   on public.event_must_play;
drop policy "dj selects blocklist of own events"    on public.event_blocklist;
drop policy "dj inserts blocklist into own events"  on public.event_blocklist;
drop policy "dj updates blocklist of own events"    on public.event_blocklist;
drop policy "dj deletes blocklist of own events"    on public.event_blocklist;

create policy "dj or partner selects must-plays" on public.event_must_play
  for select using (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_must_play.event_id)
  );
create policy "dj or partner inserts must-plays" on public.event_must_play
  for insert with check (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_must_play.event_id)
  );
-- The predicate is in BOTH using and with check, so a row cannot be re-parented
-- onto an event the writer does not participate in.
create policy "dj or partner updates must-plays" on public.event_must_play
  for update using (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_must_play.event_id)
  ) with check (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_must_play.event_id)
  );
-- using only: Postgres rejects `for delete ... with check`.
create policy "dj or partner deletes must-plays" on public.event_must_play
  for delete using (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_must_play.event_id)
  );

create policy "dj or partner selects blocklist" on public.event_blocklist
  for select using (
    exists (select 1 from public.events e
             where e.id = event_blocklist.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_blocklist.event_id)
  );
create policy "dj or partner inserts blocklist" on public.event_blocklist
  for insert with check (
    exists (select 1 from public.events e
             where e.id = event_blocklist.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_blocklist.event_id)
  );
create policy "dj or partner updates blocklist" on public.event_blocklist
  for update using (
    exists (select 1 from public.events e
             where e.id = event_blocklist.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_blocklist.event_id)
  ) with check (
    exists (select 1 from public.events e
             where e.id = event_blocklist.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_blocklist.event_id)
  );
create policy "dj or partner deletes blocklist" on public.event_blocklist
  for delete using (
    exists (select 1 from public.events e
             where e.id = event_blocklist.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_blocklist.event_id)
  );

-- event_partners. NO partner-facing update policy: claiming is
-- claim_partner_slot's job, and user_id is writable by no PostgREST role.
create policy "dj or participant selects partners" on public.event_partners
  for select using (
    user_id = (select auth.uid())
    or exists (select 1 from public.events e
                where e.id = event_partners.event_id
                  and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_partners.event_id)
  );
create policy "dj inserts partners" on public.event_partners
  for insert with check (
    exists (select 1 from public.events e
             where e.id = event_partners.event_id
               and e.dj_id = (select auth.uid()))
  );
create policy "dj updates partners" on public.event_partners
  for update using (
    exists (select 1 from public.events e
             where e.id = event_partners.event_id
               and e.dj_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.events e
             where e.id = event_partners.event_id
               and e.dj_id = (select auth.uid()))
  );
create policy "dj deletes partners" on public.event_partners
  for delete using (
    exists (select 1 from public.events e
             where e.id = event_partners.event_id
               and e.dj_id = (select auth.uid()))
  );

-- spotify_connections: readable by everyone on the event, written by its owner.
create policy "participants select connections" on public.spotify_connections
  for select using (
    exists (select 1 from public.event_partners p
             join public.events e on e.id = p.event_id
            where p.id = spotify_connections.partner_id
              and (e.dj_id = (select auth.uid()) or public.is_event_partner(p.event_id)))
  );
create policy "owner writes own connection" on public.spotify_connections
  for all using (
    exists (select 1 from public.event_partners p
             where p.id = spotify_connections.partner_id
               and p.user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.event_partners p
             where p.id = spotify_connections.partner_id
               and p.user_id = (select auth.uid()))
  );

-- spotify_tokens: the owner, and nobody else. Not the DJ, not the other
-- partner. A refresh token is the partner's credential and the DJ has no
-- business reading it even encrypted.
create policy "owner only, tokens" on public.spotify_tokens
  for all using (
    exists (select 1 from public.event_partners p
             where p.id = spotify_tokens.partner_id
               and p.user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.event_partners p
             where p.id = spotify_tokens.partner_id
               and p.user_id = (select auth.uid()))
  );

create policy "participants select taste" on public.taste_profiles
  for select using (
    exists (select 1 from public.event_partners p
             join public.events e on e.id = p.event_id
            where p.id = taste_profiles.partner_id
              and (e.dj_id = (select auth.uid()) or public.is_event_partner(p.event_id)))
  );
create policy "owner writes own taste" on public.taste_profiles
  for all using (
    exists (select 1 from public.event_partners p
             where p.id = taste_profiles.partner_id
               and p.user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.event_partners p
             where p.id = taste_profiles.partner_id
               and p.user_id = (select auth.uid()))
  );

-- artist_genres: readable by any signed-in user, writable by NONE. This row is
-- a CONTROL INPUT, not just data -- one PATCH from any registered account would
-- rewrite an artist's genres for EVERY event in the product. There is
-- deliberately no write policy here and no write grant below.
create policy "any signed-in user reads artist genres" on public.artist_genres
  for select using (true);

-- enrichment_queue: readable by the event's participants so the page can render
-- progress (two counts over this table). Written by NOBODY through PostgREST --
-- the seed, the claim and the settle all run under the service-role client.
create policy "participants read the queue" on public.enrichment_queue
  for select using (
    exists (select 1 from public.event_partners p
             join public.events e on e.id = p.event_id
            where p.id = enrichment_queue.partner_id
              and (e.dj_id = (select auth.uid())
                   or public.is_event_partner(p.event_id)))
  );

create policy "dj only, private notes" on public.event_private_notes
  for all using (
    exists (select 1 from public.events e
             where e.id = event_private_notes.event_id
               and e.dj_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.events e
             where e.id = event_private_notes.event_id
               and e.dj_id = (select auth.uid()))
  );

create policy "participants use shared notes" on public.event_shared_notes
  for all using (
    exists (select 1 from public.events e
             where e.id = event_shared_notes.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_shared_notes.event_id)
  ) with check (
    exists (select 1 from public.events e
             where e.id = event_shared_notes.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(event_shared_notes.event_id)
  );

-- ---------------------------------------------------------------------------
-- 6. Move notes out of events (§5.2)
--
-- Backfill BEFORE the drop, and for EVERY event -- not only those whose notes
-- was non-null. Five of the six seeded events have null notes, and an update
-- against a missing row returns success having written nothing, so a
-- `where notes is not null` filter would leave exactly that trap. The
-- application write path is an upsert as well: belt and braces, because an
-- event created after this migration would otherwise reintroduce it.
-- ---------------------------------------------------------------------------

insert into public.event_private_notes (event_id, body)
select id, coalesce(notes, '') from public.events;

insert into public.event_shared_notes (event_id, body)
select id, '' from public.events;

-- 20260830120000_event_song_lists.sql added both the column and the constraint.
alter table public.events drop constraint notes_len;
alter table public.events drop column notes;

-- ---------------------------------------------------------------------------
-- 7. Grants
--
-- The hosted project's default ACL hands anon and authenticated `Dxtm` on every
-- table created in public. `D` is TRUNCATE, and TRUNCATE BYPASSES RLS.
-- ---------------------------------------------------------------------------

-- INSERT is column-scoped too, not just UPDATE. A table-level insert grant
-- would let a DJ POST a row with an explicit user_id -- and an explicit id,
-- since gen_random_uuid() is only a default -- binding any account they know
-- into their event and bypassing claim_partner_slot's email verification.
grant select, delete on public.event_partners to authenticated;
grant insert (event_id, slot, display_name, invite_email)
  on public.event_partners to authenticated;

-- THE COLUMN GRANT IS THE CONTROL, not the policy. `dj updates partners` pins
-- no column, so with a table-level update grant a DJ could
--   PATCH /rest/v1/event_partners?id=eq.<slot>  {"user_id": "<own uid>"}
-- become the row's owner, and then read the couple's refresh token through
-- `owner only, tokens`. user_id must be writable by NO PostgREST role.
grant update (slot, display_name, invite_email)
  on public.event_partners to authenticated;
-- DO NOT ADD event_id TO THIS LIST. PostgREST's upsert compiles to
-- ON CONFLICT DO UPDATE SET <every column in the payload>, and a partner
-- payload necessarily carries event_id -- so an upsert here fails 42501 on its
-- SECOND run, and the obvious fix is to widen this grant. Excluding event_id
-- and user_id is what stops a row being re-parented onto another DJ's event or
-- bound to an arbitrary account. Use ignoreDuplicates (ON CONFLICT DO NOTHING).

grant select, insert, update, delete
  on public.spotify_connections, public.spotify_tokens, public.taste_profiles,
     public.event_private_notes, public.event_shared_notes
  to authenticated;

-- SELECT ONLY, deliberately. Writes go through upsert_artist_genres, which only
-- service_role may execute. Revisions 1-4 each got this wrong in a different
-- way; do not "fix" it by adding insert.
grant select on public.artist_genres to authenticated;

-- SELECT only, for the progress counts. Every write is service-role.
grant select on public.enrichment_queue to authenticated;

-- service_role needs EXPLICIT DML. The hosted default ACL for a new public
-- table is `service_role=Dxtm` -- TRUNCATE, REFERENCES, TRIGGER, MAINTAIN and
-- NOT select/insert/update/delete. service_role carries rolbypassrls, but
-- BYPASSRLS does not bypass TABLE PRIVILEGES: without these grants it would
-- hold TRUNCATE on all eight tables and not SELECT, and §5.3's service-role
-- writes (the queue seed, claim and settle; upsert_artist_genres; the
-- taste_profiles recompute) would fail 42501.
--
-- Same omission class as the anon/authenticated hardening above, one role
-- over: the grant surface was closed carefully for two roles and the ADJACENT
-- role was never considered. Plan A itself uses no service-role client, so
-- this is here to save a second hand-run push when Plan C lands.
grant select, insert, update, delete
  on public.enrichment_queue, public.artist_genres, public.taste_profiles
  to service_role;

revoke truncate, references, trigger, maintain
  on public.event_partners, public.spotify_connections, public.spotify_tokens,
     public.taste_profiles, public.artist_genres, public.enrichment_queue,
     public.event_private_notes, public.event_shared_notes
  from anon, authenticated, service_role;

revoke all on public.event_partners      from anon;
revoke all on public.spotify_connections from anon;
revoke all on public.spotify_tokens      from anon;
revoke all on public.taste_profiles      from anon;
revoke all on public.artist_genres       from anon;
revoke all on public.enrichment_queue    from anon;
revoke all on public.event_private_notes from anon;
revoke all on public.event_shared_notes  from anon;

-- public.events grants are NOT modified.
