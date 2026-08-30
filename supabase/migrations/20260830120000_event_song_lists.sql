-- Song lists for one event: what the couple insists on, and what they refuse.
-- docs/specs/2026-08-30-event-detail-design.md §5.
--
-- MUST sort after 20260830000000_event_phase.sql, the last migration to touch
-- public.events. Do not renumber this file to tidy it.

create type public.event_segment        as enum ('ceremony', 'reception', 'party');
create type public.blocklist_entry_type as enum ('artist', 'song', 'genre');

create table public.event_must_play (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  segment    public.event_segment not null,
  title      text not null,
  artist     text,
  moment     text,
  created_at timestamptz not null default now(),
  constraint must_play_title_len  check (char_length(title) between 1 and 200),
  constraint must_play_artist_len check (artist is null or char_length(artist) between 1 and 200),
  constraint must_play_moment_len check (moment is null or char_length(moment) between 1 and 100)
);

-- No `position` column, unlike played_songs. A recap playlist is ordered and
-- the order IS the point; these are preference lists that the screen only ever
-- appends to, so `order by created_at, id` is the whole ordering story and a
-- delete never leaves a gap to renumber.
--
-- artist and moment are nullable because the artboard renders both
-- conditionally -- it already expects them to be absent. title is not.

create table public.event_blocklist (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  segment    public.event_segment not null,
  entry_type public.blocklist_entry_type not null,
  value      text not null,
  created_at timestamptz not null default now(),
  constraint blocklist_value_len check (char_length(value) between 1 and 100)
);

create index event_must_play_event_segment_idx
  on public.event_must_play (event_id, segment, created_at);
create index event_blocklist_event_segment_idx
  on public.event_blocklist (event_id, segment, created_at);

-- One row per ceremony slot. An INTEGRITY GUARD ONLY -- never an ON CONFLICT
-- target. saveEventDetails writes each slot by its row id (design §6.4), which
-- is why this can stay partial: Postgres infers a partial index as an
-- ON CONFLICT arbiter only when the statement repeats the predicate, and
-- PostgREST cannot emit that WHERE. It stays partial rather than becoming a
-- plain unique (event_id, segment, moment) because reception and party
-- must-plays may legitimately repeat a moment -- two songs both marked
-- 'Dinner' is the field being used as intended.
create unique index event_must_play_ceremony_slot_idx
  on public.event_must_play (event_id, moment)
  where segment = 'ceremony';

-- 'Nickelback' and 'nickelback' are the same instruction to a DJ.
create unique index event_blocklist_unique_value_idx
  on public.event_blocklist (event_id, segment, entry_type, lower(value));

alter table public.events
  add column notes text,
  add constraint notes_len check (notes is null or char_length(notes) <= 2000);

alter table public.event_must_play enable row level security;
alter table public.event_blocklist enable row level security;

-- Neither table carries an owner column. Its owner is its event's owner, said
-- once as a predicate rather than denormalised into a dj_id that could drift
-- away from the event's -- the shape played_songs already uses.
--
-- `(select auth.uid())` rather than bare auth.uid() so Postgres evaluates it
-- once per statement instead of once per row.

create policy "dj selects must-plays of own events" on public.event_must_play
  for select using (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
  );

create policy "dj inserts must-plays into own events" on public.event_must_play
  for insert with check (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
  );

-- The `with check` half is what stops a DJ re-parenting one of their own rows
-- onto another DJ's event: `using` admits the row they own, then `with check`
-- evaluates the predicate against the NEW event_id and refuses.
create policy "dj updates must-plays of own events" on public.event_must_play
  for update using (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
  );

-- `using` only. Postgres rejects `for delete ... with check` outright
-- ("WITH CHECK cannot be applied to SELECT or DELETE"), and a delete policy
-- FILTERS rather than raising: another DJ's delete affects zero rows and
-- returns no error. That is the assertion task 14 makes.
create policy "dj deletes must-plays of own events" on public.event_must_play
  for delete using (
    exists (select 1 from public.events e
             where e.id = event_must_play.event_id
               and e.dj_id = (select auth.uid()))
  );

create policy "dj selects blocklist of own events" on public.event_blocklist
  for select using (
    exists (select 1 from public.events e
             where e.id = event_blocklist.event_id
               and e.dj_id = (select auth.uid()))
  );

create policy "dj inserts blocklist into own events" on public.event_blocklist
  for insert with check (
    exists (select 1 from public.events e
             where e.id = event_blocklist.event_id
               and e.dj_id = (select auth.uid()))
  );

create policy "dj updates blocklist of own events" on public.event_blocklist
  for update using (
    exists (select 1 from public.events e
             where e.id = event_blocklist.event_id
               and e.dj_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.events e
             where e.id = event_blocklist.event_id
               and e.dj_id = (select auth.uid()))
  );

create policy "dj deletes blocklist of own events" on public.event_blocklist
  for delete using (
    exists (select 1 from public.events e
             where e.id = event_blocklist.event_id
               and e.dj_id = (select auth.uid()))
  );

-- events needs no new policy for `notes`: RLS policies are per-row, not
-- per-column, and events carries a TABLE-level grant update (unlike profiles,
-- which was narrowed to two columns). Verified during design review.

grant select, insert, update, delete
  on public.event_must_play, public.event_blocklist to authenticated;

-- The same hardening 20260829171500_events.sql documents at length: the hosted
-- project's default ACL hands anon and authenticated Dxtm on every table
-- postgres creates in public, D is TRUNCATE, and TRUNCATE bypasses RLS. No
-- code path here can emit one (PostgREST has no TRUNCATE verb), so this is
-- defence in depth -- but these tables must not be laxer than the ones beside
-- them.
revoke truncate, references, trigger, maintain
  on public.event_must_play, public.event_blocklist from anon, authenticated;
revoke all on public.event_must_play from anon;
revoke all on public.event_blocklist from anon;
