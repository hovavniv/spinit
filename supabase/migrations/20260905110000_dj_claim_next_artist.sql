-- dj_claim_next_artist: the DJ-side artist enrichment work-list claim
-- (design §6.2b, Task 15b). A NEW migration rather than amending
-- 20260905000000_live_event.sql -- that migration may already be pushed, and
-- a migration is never edited once committed.
--
-- No advisory lock, deliberately: this route's critical section spans
-- enrichArtist's outbound HTTP calls, which cannot share a transaction with
-- this function (every PostgREST call is its own transaction), so a lock
-- taken here would already be released before enrichArtist even starts --
-- verified by running it, not assumed. The stamp (attempts/last_attempt_at)
-- IS the durable claim instead, mirroring claim_next_artist's claimed_at for
-- the partner queue -- the same problem, already solved correctly elsewhere
-- in this codebase.
--
-- Verified against a throwaway Postgres 17 (2026-09-05): sequential claims on
-- a two-artist fixture return distinct artists in order, a third claim
-- returns nothing while both are within backoff, an artist past its backoff
-- window is reclaimed, and a `status = 'resolved'` artist is never reclaimed
-- regardless of how far past its last attempt.

create or replace function public.dj_claim_next_artist(p_event_id uuid)
returns table (spotify_artist_id text, artist_name text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Ensure every artist referenced by a pending suggestion has an
  -- artist_genres row to claim -- insert ... on conflict do nothing is
  -- itself safe under concurrency (the unique index absorbs the race), which
  -- decouples "make sure a claimable row exists" from "claim it atomically".
  insert into public.artist_genres (event_id, spotify_artist_id, artist_name, status)
  select distinct p_event_id, sta.spotify_artist_id, sta.artist_name, 'pending'::public.enrichment_status
    from public.spotify_track_artists sta
    join public.song_suggestions ss on ss.spotify_track_id = sta.spotify_track_id
   where ss.event_id = p_event_id
     and ss.status = 'pending'
  -- ON CONFLICT's column list does not accept table-qualified names, and a
  -- bare column list is ambiguous here since this function's own OUT
  -- parameters (spotify_artist_id, artist_name) shadow it as PL/pgSQL
  -- variables -- exactly the class of bug claim_next_artist's own comment
  -- warns about for its `event_id` OUT parameter. Naming the constraint
  -- sidesteps the ambiguity rather than fighting a qualifier the grammar
  -- does not accept in this position.
  on conflict on constraint artist_genres_pkey do nothing;

  -- The claim itself: an atomic update ... where (select ... for update skip
  -- locked) ... returning. Two concurrent callers cannot claim the same row:
  -- the inner select's row lock makes the second skip it via skip locked,
  -- and the stamp this statement writes is what the NEXT call's backoff
  -- predicate reads, surviving even a process dying mid-enrichment.
  return query
  update public.artist_genres ag
     set attempts = ag.attempts + 1,
         last_attempt_at = now()
   where ag.event_id = p_event_id
     and ag.spotify_artist_id = (
       select ag2.spotify_artist_id
         from public.artist_genres ag2
        where ag2.event_id = p_event_id
          and ag2.status <> 'resolved'
          and (ag2.last_attempt_at is null
               or ag2.last_attempt_at < now() - (interval '1 minute' * power(2, least(ag2.attempts, 5))))
          and exists (
            select 1
              from public.spotify_track_artists sta
              join public.song_suggestions ss on ss.spotify_track_id = sta.spotify_track_id
             where ss.event_id = p_event_id
               and ss.status = 'pending'
               and sta.spotify_artist_id = ag2.spotify_artist_id
          )
        order by ag2.spotify_artist_id
        limit 1
        for update of ag2 skip locked
     )
   returning ag.spotify_artist_id, ag.artist_name;
end;
$$;

-- security invoker, not definer: the DJ already holds select/insert/update on
-- artist_genres via "participants use artist genres" (20260901090000), so no
-- elevation is needed -- same reasoning dj_play_suggestion/dj_play_pick use.
-- Not granted to anon; reachable only by an authenticated DJ through RLS.
revoke all on function public.dj_claim_next_artist(uuid) from public, anon;
grant execute on function public.dj_claim_next_artist(uuid) to authenticated;
