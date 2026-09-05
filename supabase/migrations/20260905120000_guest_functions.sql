-- The guest boundary: six security definer functions, and this count is the
-- definition of the anon attack surface (design §4.1-4.8, Task 20). anon
-- gets NO table grants at all -- every guest write goes through one of
-- these, each of which re-derives the event from the guest's own secret
-- (the join token, or the session id from a prior guest_join) and does
-- exactly one thing.
--
-- Common to all six: security definer, set search_path = '', every table
-- reference schema-qualified, and `revoke all on function ... from public`
-- BEFORE the grant to anon. Postgres grants execute to PUBLIC by default, so
-- a function merely not granted to anon is still callable by it -- the
-- single most common way a security definer function becomes an open door.
--
-- Every guard is written `is null or ...`, never the natural-looking form:
-- char_length(NULL) is NULL, and an `if` on NULL does not fire, so the
-- natural spelling lets a NULL through to a NOT NULL column.
--
-- NOT pushed until a fresh-context review of this file comes back clean
-- (the gate, §11) -- this is the only thing between the open internet and
-- the database.

-- ---------------------------------------------------------------------------
-- guest_event: the only one of the six that does not require a live event --
-- "this event has ended" is exactly what it exists to be able to say.
-- Reachable by TOKEN, not an event id, so only someone holding the printed
-- secret can reach it. Two values only: no id, no venue, no date, no dj, no
-- token echo, nothing about any other event.
-- ---------------------------------------------------------------------------

create function public.guest_event(p_token text)
returns table (couple_names text, is_live boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_couple_names text;
  v_status public.event_status;
begin
  select e.couple_names, e.status
    into v_couple_names, v_status
    from public.events e
   where e.join_token = p_token;

  if not found then
    raise exception 'no_such_event';
  end if;

  return query select v_couple_names, (v_status = 'live');
end;
$$;

revoke all on function public.guest_event(text) from public;
grant execute on function public.guest_event(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- guest_join: mints a guest_sessions row. TWO lookups, not one combined
-- predicate -- find by token, then check status -- so it can raise both
-- no_such_event and event_not_live. A single "token = x and status = 'live'"
-- predicate can only ever produce one failure, and S7.3's three-state guest
-- screen (bad link / not started or ended / joined) depends on the
-- distinction existing.
-- ---------------------------------------------------------------------------

create function public.guest_join(p_token text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_event_id uuid;
  v_status public.event_status;
  v_session_id uuid;
begin
  -- btrim's default second argument is a single space; a name of only tab,
  -- newline or CR would pass char_length > 0 untrimmed and render as blank
  -- everywhere it's shown (the DJ's activity feed, the queue, the couple's
  -- recap) -- found by the fresh-context security review of this file,
  -- verified empirically before this fix existed. NBSP/ZWSP and other
  -- non-ASCII blank-looking characters are NOT caught by this (or by any
  -- single btrim call) and remain a known, narrower residual gap.
  v_name := btrim(p_display_name, ' ' || chr(9) || chr(10) || chr(13));
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'bad_display_name';
  end if;

  select e.id, e.status
    into v_event_id, v_status
    from public.events e
   where e.join_token = p_token;

  if not found then
    raise exception 'no_such_event';
  end if;

  if v_status <> 'live' then
    raise exception 'event_not_live';
  end if;

  insert into public.guest_sessions (event_id, display_name)
  values (v_event_id, v_name)
  returning id into v_session_id;

  return v_session_id;
end;
$$;

revoke all on function public.guest_join(text, text) from public;
grant execute on function public.guest_join(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- guest_suggest: the advisory lock is the FIRST statement, before anything
-- else -- without it the <=3 cap is a check-then-insert race, the same race
-- the unique(event_id, spotify_track_id) constraint exists to prevent for
-- the dedupe rule. An existing suggestion is checked BEFORE counting, so a
-- duplicate never consumes a cap slot. p_title/p_artist are stored as
-- UNTRUSTED display text (design S4.3) -- trimmed and bounded here, never
-- matched on by anything; p_track_id is the only argument any decision
-- depends on. No spotify_tracks lookup here -- resolution is the DJ's job,
-- on the DJ's poll, under the DJ's credential.
-- ---------------------------------------------------------------------------

create function public.guest_suggest(
  p_session_id uuid,
  p_track_id text,
  p_title text,
  p_artist text
)
returns table (suggestion_id uuid, was_existing boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_status public.event_status;
  v_title text;
  v_artist text;
  v_existing_id uuid;
  v_count int;
  v_new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));

  select gs.event_id into v_event_id
    from public.guest_sessions gs
   where gs.id = p_session_id;

  if not found then
    raise exception 'no_such_session';
  end if;

  select e.status into v_status from public.events e where e.id = v_event_id;
  if v_status is null or v_status <> 'live' then
    raise exception 'event_not_live';
  end if;

  if p_track_id is null or p_track_id !~ '^[A-Za-z0-9]{22}$' then
    raise exception 'bad_track';
  end if;

  v_title := btrim(p_title);
  v_artist := btrim(p_artist);
  if v_title is null or char_length(v_title) not between 1 and 200
     or v_artist is null or char_length(v_artist) not between 1 and 200 then
    raise exception 'bad_input';
  end if;

  -- Existing suggestion of this track on this event? Vote for it, no cap
  -- slot consumed -- the guest added nothing new to the queue.
  select ss.id into v_existing_id
    from public.song_suggestions ss
   where ss.event_id = v_event_id
     and ss.spotify_track_id = p_track_id;

  if found then
    insert into public.suggestion_votes (suggestion_id, guest_id)
    values (v_existing_id, p_session_id)
    on conflict do nothing;

    return query select v_existing_id, true;
    return;
  end if;

  -- used_count counts ALL statuses (design S4.4/S4.7's guest_queue note) --
  -- a played or skipped suggestion still occupied a slot.
  select count(*) into v_count
    from public.song_suggestions ss
   where ss.suggested_by = p_session_id;

  if v_count >= 3 then
    raise exception 'suggestion_limit';
  end if;

  insert into public.song_suggestions (event_id, spotify_track_id, title, artist, suggested_by)
  values (v_event_id, p_track_id, v_title, v_artist, p_session_id)
  on conflict (event_id, spotify_track_id) do nothing
  returning id into v_new_id;

  if v_new_id is null then
    -- Another guest won the race under the same lock window: re-select and
    -- fall through to voting on the winner, same as the existing-suggestion
    -- branch above.
    select ss.id into v_new_id
      from public.song_suggestions ss
     where ss.event_id = v_event_id
       and ss.spotify_track_id = p_track_id;

    insert into public.suggestion_votes (suggestion_id, guest_id)
    values (v_new_id, p_session_id)
    on conflict do nothing;

    return query select v_new_id, true;
    return;
  end if;

  insert into public.suggestion_votes (suggestion_id, guest_id)
  values (v_new_id, p_session_id)
  on conflict do nothing;

  return query select v_new_id, false;
end;
$$;

revoke all on function public.guest_suggest(uuid, text, text, text) from public;
grant execute on function public.guest_suggest(uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- guest_vote: requires status = 'live' HERE, not just under guest_suggest --
-- an earlier draft of this design omitted it here while arguing for it one
-- section up, which would have let voting keep working after the DJ ended
-- the event, on a token the design calls inert everywhere else. A uuid
-- being unguessable is not an authorization control, so the suggestion's
-- event_id must equal the session's own event, explicitly.
-- ---------------------------------------------------------------------------

create function public.guest_vote(p_session_id uuid, p_suggestion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_status public.event_status;
  v_suggestion_event_id uuid;
begin
  select gs.event_id into v_event_id
    from public.guest_sessions gs
   where gs.id = p_session_id;

  if not found then
    raise exception 'no_such_session';
  end if;

  select e.status into v_status from public.events e where e.id = v_event_id;
  if v_status is null or v_status <> 'live' then
    raise exception 'event_not_live';
  end if;

  select ss.event_id into v_suggestion_event_id
    from public.song_suggestions ss
   where ss.id = p_suggestion_id;

  if not found or v_suggestion_event_id <> v_event_id then
    raise exception 'wrong_event';
  end if;

  insert into public.suggestion_votes (suggestion_id, guest_id)
  values (p_suggestion_id, p_session_id)
  on conflict do nothing;
end;
$$;

revoke all on function public.guest_vote(uuid, uuid) from public;
grant execute on function public.guest_vote(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- guest_queue: pending suggestions only, ordered votes desc, created_at, id
-- -- CLAUDE.md's now()-tiebreaker rule applies to these rows exactly as it
-- does everywhere else in this app. used_count counts ALL statuses (a
-- played/skipped suggestion still occupied a cap slot) -- deriving it from
-- the returned pending-only rows would under-report and tell the guest a
-- slot is free that guest_suggest then refuses. Nothing about OTHER guests:
-- no suggested_by, no session ids, no vote authorship.
-- ---------------------------------------------------------------------------

create function public.guest_queue(p_session_id uuid)
returns table (
  suggestion_id uuid,
  title text,
  artist text,
  votes int,
  voted boolean,
  mine boolean,
  used_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_status public.event_status;
  v_used_count int;
begin
  select gs.event_id into v_event_id
    from public.guest_sessions gs
   where gs.id = p_session_id;

  if not found then
    raise exception 'no_such_session';
  end if;

  select e.status into v_status from public.events e where e.id = v_event_id;
  if v_status is null or v_status <> 'live' then
    raise exception 'event_not_live';
  end if;

  select count(*) into v_used_count
    from public.song_suggestions ss
   where ss.suggested_by = p_session_id;

  return query
  select
    ss.id,
    ss.title,
    ss.artist,
    (select count(*)::int from public.suggestion_votes sv where sv.suggestion_id = ss.id),
    exists (
      select 1 from public.suggestion_votes sv
       where sv.suggestion_id = ss.id and sv.guest_id = p_session_id
    ),
    (ss.suggested_by = p_session_id),
    v_used_count
    from public.song_suggestions ss
   where ss.event_id = v_event_id
     and ss.status = 'pending'
   order by 4 desc, ss.created_at, ss.id;
end;
$$;

revoke all on function public.guest_queue(uuid) from public;
grant execute on function public.guest_queue(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- guest_search_allow: requires status = 'live', exactly as the three other
-- session-bearing functions do -- an earlier draft omitted this check here,
-- in the middle of the section arguing for it, which would have let anyone
-- who joined during the event keep hitting the shared, cross-tenant Spotify
-- app token for 12 hours after it ended. Ceiling 60 per session (roughly 20
-- searches with the picker's debounce firing three times each).
-- ---------------------------------------------------------------------------

create function public.guest_search_allow(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_status public.event_status;
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));

  select gs.event_id into v_event_id
    from public.guest_sessions gs
   where gs.id = p_session_id;

  if not found then
    raise exception 'no_such_session';
  end if;

  select e.status into v_status from public.events e where e.id = v_event_id;
  if v_status is null or v_status <> 'live' then
    raise exception 'event_not_live';
  end if;

  update public.guest_sessions
     set search_count = search_count + 1
   where id = p_session_id
  returning search_count into v_count;

  return v_count <= 60;
end;
$$;

revoke all on function public.guest_search_allow(uuid) from public;
grant execute on function public.guest_search_allow(uuid) to anon, authenticated;
