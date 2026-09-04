-- Live event: guest sessions, song suggestions, votes, and the Spotify
-- track cache the ranking engine matches against.
--
-- Design: Live Event slice, Task 1.

-- ---------------------------------------------------------------------------
-- 1. events: join token + phase clock
-- ---------------------------------------------------------------------------

alter table public.events
  add column join_token text,
  add column phase_started_at timestamptz;

-- Nullable, no default: existing rows have neither and inventing values would
-- be inventing data. No CHECK requiring a live event to have a non-null
-- phase_started_at -- deliberately omitted; a null means "no phase clock" and
-- the ranking engine drops that term rather than guessing.
create unique index events_join_token_key on public.events (join_token);

alter table public.events
  add constraint join_token_shape check (join_token is null or join_token ~ '^[A-Za-z0-9]{22}$');

-- ---------------------------------------------------------------------------
-- 2. played_songs: which spotify track it resolved to, if any
-- ---------------------------------------------------------------------------

alter table public.played_songs
  add column spotify_track_id text;

alter table public.played_songs
  add constraint played_track_id_shape check (spotify_track_id is null or spotify_track_id ~ '^[A-Za-z0-9]{22}$');

-- ---------------------------------------------------------------------------
-- 3. Enums
-- ---------------------------------------------------------------------------

create type public.suggestion_status as enum ('pending', 'played', 'skipped');

-- ---------------------------------------------------------------------------
-- 4. guest_sessions
-- ---------------------------------------------------------------------------

create table public.guest_sessions (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  display_name text not null,
  search_count int not null default 0,
  created_at   timestamptz not null default now(),
  constraint display_name_len check (char_length(display_name) between 1 and 40)
);

create index guest_sessions_event_idx on public.guest_sessions (event_id);

-- ---------------------------------------------------------------------------
-- 5. song_suggestions
-- ---------------------------------------------------------------------------

create table public.song_suggestions (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events(id) on delete cascade,
  spotify_track_id  text not null,
  title             text not null,
  artist            text not null,
  suggested_by      uuid not null references public.guest_sessions(id) on delete cascade,
  status            public.suggestion_status not null default 'pending',
  created_at        timestamptz not null default now(),
  constraint track_id_shape  check (spotify_track_id ~ '^[A-Za-z0-9]{22}$'),
  constraint title_len       check (char_length(title)  between 1 and 200),
  constraint artist_len      check (char_length(artist) between 1 and 200),
  unique (event_id, spotify_track_id)
);

comment on column public.song_suggestions.title is
  'Untrusted guest-supplied display text, copied at suggestion time. Nothing in the app matches on it -- ranking and dedup key off spotify_track_id.';
comment on column public.song_suggestions.artist is
  'Untrusted guest-supplied display text, copied at suggestion time. Nothing in the app matches on it -- ranking and dedup key off spotify_track_id / spotify_track_artists.';

create index song_suggestions_event_status_idx on public.song_suggestions (event_id, status, created_at);

-- ---------------------------------------------------------------------------
-- 6. suggestion_votes
-- ---------------------------------------------------------------------------

create table public.suggestion_votes (
  suggestion_id uuid not null references public.song_suggestions(id) on delete cascade,
  guest_id      uuid not null references public.guest_sessions(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (suggestion_id, guest_id)
);

create index suggestion_votes_guest_idx on public.suggestion_votes (guest_id);

-- ---------------------------------------------------------------------------
-- 7. spotify_tracks / spotify_track_artists (public catalogue cache)
-- ---------------------------------------------------------------------------

create table public.spotify_tracks (
  spotify_track_id text primary key,
  title            text not null,
  artist           text not null,     -- first artist, for display only
  fetched_at       timestamptz not null default now(),
  constraint track_id_shape check (spotify_track_id ~ '^[A-Za-z0-9]{22}$'),
  constraint title_len     check (char_length(title)  between 1 and 200),
  constraint artist_len    check (char_length(artist) between 1 and 200)
);

-- One row per artist on a track. This is what the artist-repeat and blocklist
-- ranking terms match against. A child table rather than parallel arrays: a
-- prior array-based version needed a subquery in its alignment CHECK, and
-- subqueries are forbidden in CHECK constraints -- it failed to compile.
create table public.spotify_track_artists (
  spotify_track_id  text not null references public.spotify_tracks(spotify_track_id) on delete cascade,
  ordinal           smallint not null,
  spotify_artist_id text not null,
  artist_name       text not null,
  primary key (spotify_track_id, ordinal),
  constraint artist_id_shape  check (spotify_artist_id ~ '^[A-Za-z0-9]{22}$'),
  constraint artist_name_len  check (char_length(artist_name) between 1 and 200),
  constraint ordinal_range    check (ordinal between 0 and 11)
);

create index spotify_track_artists_artist_idx on public.spotify_track_artists (spotify_artist_id);

alter table public.spotify_tracks        enable row level security;
alter table public.spotify_track_artists enable row level security;

-- Public catalogue data, not scoped per event: any authenticated DJ/partner
-- may read or upsert it.
create policy "authenticated reads tracks" on public.spotify_tracks
  for select to authenticated using (true);

create policy "authenticated writes tracks" on public.spotify_tracks
  for insert to authenticated with check (true);

create policy "authenticated updates tracks" on public.spotify_tracks
  for update to authenticated using (true) with check (true);

create policy "authenticated reads track artists" on public.spotify_track_artists
  for select to authenticated using (true);

create policy "authenticated writes track artists" on public.spotify_track_artists
  for insert to authenticated with check (true);

create policy "authenticated updates track artists" on public.spotify_track_artists
  for update to authenticated using (true) with check (true);

grant select, insert, update on public.spotify_tracks, public.spotify_track_artists to authenticated;
revoke all on public.spotify_tracks, public.spotify_track_artists from anon;
revoke truncate, references, trigger, maintain
  on public.spotify_tracks, public.spotify_track_artists from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. RLS on the three guest-facing tables
-- ---------------------------------------------------------------------------

alter table public.guest_sessions   enable row level security;
alter table public.song_suggestions enable row level security;
alter table public.suggestion_votes enable row level security;

-- guest_sessions: DJ reads only. No insert/update/delete for the DJ -- guest
-- sessions are created by the guest-facing flow (service role), not by the DJ.
create policy "dj selects guest sessions of own events" on public.guest_sessions
  for select to authenticated using (
    exists (select 1 from public.events e
             where e.id = guest_sessions.event_id
               and e.dj_id = (select auth.uid()))
  );

-- song_suggestions: DJ reads, and updates only (Skip flips status). No
-- partner policy -- the couple is not admitted to the live queue.
create policy "dj selects suggestions of own events" on public.song_suggestions
  for select to authenticated using (
    exists (select 1 from public.events e
             where e.id = song_suggestions.event_id
               and e.dj_id = (select auth.uid()))
  );

create policy "dj updates suggestions of own events" on public.song_suggestions
  for update to authenticated using (
    exists (select 1 from public.events e
             where e.id = song_suggestions.event_id
               and e.dj_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.events e
             where e.id = song_suggestions.event_id
               and e.dj_id = (select auth.uid()))
  );

-- suggestion_votes: DJ reads only, reached via song_suggestions -> events.
create policy "dj selects votes of own events" on public.suggestion_votes
  for select to authenticated using (
    exists (select 1 from public.song_suggestions s
             join public.events e on e.id = s.event_id
             where s.id = suggestion_votes.suggestion_id
               and e.dj_id = (select auth.uid()))
  );

revoke all on public.guest_sessions, public.song_suggestions, public.suggestion_votes from anon;
revoke truncate, references, trigger, maintain on public.guest_sessions from anon, authenticated;
revoke truncate, references, trigger, maintain on public.song_suggestions from anon, authenticated;
revoke truncate, references, trigger, maintain on public.suggestion_votes from anon, authenticated;

grant select on public.guest_sessions to authenticated;
grant select, update on public.song_suggestions to authenticated;
grant select on public.suggestion_votes to authenticated;

-- ---------------------------------------------------------------------------
-- 9. played_songs: widen SELECT to the couple as well as the DJ
-- ---------------------------------------------------------------------------

drop policy "dj selects songs of own events" on public.played_songs;

create policy "dj or partner selects songs of event" on public.played_songs
  for select using (
    exists (select 1 from public.events e
             where e.id = played_songs.event_id
               and (e.dj_id = (select auth.uid()) or public.is_event_partner(e.id)))
  );

-- ---------------------------------------------------------------------------
-- 10. RPCs: dj_play_suggestion, dj_play_pick
-- ---------------------------------------------------------------------------

-- Both run as the CALLER (security invoker) -- RLS's existing
-- "dj inserts songs into own events" / "dj updates songs of own events"
-- policies on played_songs, and the DJ's update policy on song_suggestions,
-- are the authorization. Not granted to anon; called by an authenticated DJ
-- through normal RLS.

create function public.dj_play_suggestion(p_event_id uuid, p_suggestion_id uuid)
returns table ("position" int, was_already_played boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.suggestion_status;
  v_track_id text;
  v_suggestion_title text;
  v_suggestion_artist text;
  v_suggested_by_name text;
  v_resolved_title text;
  v_resolved_artist text;
  v_position int;
begin
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  select s.status, s.spotify_track_id, s.title, s.artist, gs.display_name
    into v_status, v_track_id, v_suggestion_title, v_suggestion_artist, v_suggested_by_name
  from public.song_suggestions s
  join public.guest_sessions gs on gs.id = s.suggested_by
  where s.id = p_suggestion_id and s.event_id = p_event_id;

  if not found then
    raise exception 'suggestion % not found for event %', p_suggestion_id, p_event_id;
  end if;

  if v_status = 'played' then
    return query
      select ps.position, true
      from public.played_songs ps
      where ps.event_id = p_event_id
      order by ps.position desc
      limit 1;
    return;
  end if;

  -- Prefer the resolved spotify_tracks row's title/artist; fall back to the
  -- suggestion's own untrusted display text if unresolved.
  select st.title, st.artist into v_resolved_title, v_resolved_artist
  from public.spotify_tracks st
  where st.spotify_track_id = v_track_id;

  select coalesce(max(ps.position), 0) + 1 into v_position
  from public.played_songs ps
  where ps.event_id = p_event_id;

  insert into public.played_songs (
    event_id, position, title, artist, suggested_by, played_at, spotify_track_id
  )
  values (
    p_event_id,
    v_position,
    coalesce(v_resolved_title, v_suggestion_title),
    coalesce(v_resolved_artist, v_suggestion_artist),
    v_suggested_by_name,
    now(),
    case
      when exists (select 1 from public.spotify_tracks st where st.spotify_track_id = v_track_id)
        then v_track_id
      else null
    end
  );

  update public.song_suggestions set status = 'played' where id = p_suggestion_id;

  return query select v_position, false;
end;
$$;

create function public.dj_play_pick(p_event_id uuid, p_title text, p_artist text, p_track_id text)
returns table ("position" int, was_already_played boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_position int;
  v_existing_position int;
begin
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  select ps.position into v_existing_position
  from public.played_songs ps
  where ps.event_id = p_event_id
    and ps.spotify_track_id = p_track_id
    and ps.played_at > now() - interval '60 seconds'
  order by ps.played_at desc
  limit 1;

  if found then
    return query select v_existing_position, true;
    return;
  end if;

  select coalesce(max(ps.position), 0) + 1 into v_position
  from public.played_songs ps
  where ps.event_id = p_event_id;

  insert into public.played_songs (
    event_id, position, title, artist, suggested_by, played_at, spotify_track_id
  )
  values (p_event_id, v_position, p_title, p_artist, null, now(), p_track_id);

  return query select v_position, false;
end;
$$;
