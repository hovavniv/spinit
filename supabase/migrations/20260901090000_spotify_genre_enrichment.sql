-- Spotify integration, plan C2: genre enrichment schema and access.
--
-- Design: docs/specs/2026-08-30-spotify-integration-design.md (revision 6)
-- §5.1 (artist_genres reshaped, per-event), §5.3 (its participant policy and
-- enrichment_queue's missing write policy), §2.10/§2.11 (claim_next_artist),
-- §12.65 (the three live gaps this migration closes).
--
-- Three things are wrong on the LIVE project today, none of them fixed by any
-- migration since 20260831090000 shipped:
--
--   1. artist_genres is keyed on spotify_artist_id ALONE -- a global cache --
--      and revision 6 rescoped it per event (§12.7: the global design was
--      priced for a user base Spotify's five-users-ever quota does not
--      permit). Verified via `supabase db query --linked` before writing this
--      migration: primary key is (spotify_artist_id), the only read policy is
--      "any signed-in user reads artist genres", there is no write policy,
--      grants to `authenticated` are SELECT only, and the table is EMPTY --
--      so the rekey below has nothing to lose.
--   2. enrichment_queue has a SELECT policy ("participants read the queue",
--      shipped by 20260831090000_spotify_foundation.sql:579) and no WRITE
--      policy at all -- verified the same way. It is write-unreachable through
--      PostgREST today.
--   3. purge_partner_connection has three deletes; it needs a fourth, for
--      enrichment_queue, or an unlinked partner's stale queue rows collide
--      with the next claimant's re-synced ones on
--      unique (partner_id, artist_id).
--
-- Also new here: claim_next_artist (§2.11), the row-locking claim function
-- phase 2 polls through. Not live in any form; this is its first migration.
--
-- Must sort AFTER 20260831180000_spotify_song_ids_required.sql.

-- ---------------------------------------------------------------------------
-- 2a. artist_genres becomes per-event.
-- ---------------------------------------------------------------------------

alter table public.artist_genres add column event_id uuid
  references public.events(id) on delete cascade;

-- Safe only because the table is a cache with no referents and is EMPTY on
-- live today (verified above, not assumed). A non-empty table here would mean
-- this comment's premise no longer holds and the delete would need a rethink,
-- not a blind run.
delete from public.artist_genres;

alter table public.artist_genres alter column event_id set not null;

alter table public.artist_genres drop constraint artist_genres_pkey;
alter table public.artist_genres
  add constraint artist_genres_pkey primary key (event_id, spotify_artist_id);

drop policy "any signed-in user reads artist genres" on public.artist_genres;

-- The participant policy from design §5.3, verbatim: both verbs, scoped by
-- event_id, so a bad row is confined to the wedding whose participant wrote
-- it. Matches the DJ-clause-first shape every other per-event policy in this
-- project uses (is_event_partner is a security definer function and does not
-- get inlined, so the cheap DJ check stays first and the partner branch is
-- only reached when it is false).
create policy "participants use artist genres" on public.artist_genres
  for all using (
    exists (select 1 from public.events e
             where e.id = artist_genres.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(artist_genres.event_id)
  ) with check (
    exists (select 1 from public.events e
             where e.id = artist_genres.event_id
               and e.dj_id = (select auth.uid()))
    or public.is_event_partner(artist_genres.event_id)
  );

drop index public.artist_genres_retry_idx;
create index artist_genres_retry_idx
  on public.artist_genres (event_id, status, last_attempt_at) where status = 'failed';

-- No upsert_artist_genres function and no service-role key (design §5.3): a
-- participant writes genre rows for their own wedding directly, and the worst
-- they can do is give themselves a wrong taste report -- self-harm, not a
-- control input for strangers, now that the cache is scoped per event.
grant select, insert, update on public.artist_genres to authenticated;

-- The shipped 20260831090000 migration's header comment on this table
-- ("GLOBAL, not per-event: two weddings both wanting Ed Sheeran cost one
-- enrichment, ever") described the key this ALTER just replaced and is false
-- as of this line. Recorded here, as a forward migration, rather than by
-- editing that file in place -- an applied migration is the historical
-- record of what actually ran, and this is where `\d+ artist_genres` and the
-- table editor surface it, sitting next to the change that made it true.
comment on table public.artist_genres is
  'Per-event genre cache, keyed (event_id, spotify_artist_id). Was global by '
  'spotify_artist_id alone until this migration -- see 20260831090000 for the '
  'shape this table shipped with and why that shape stopped holding.';

-- ---------------------------------------------------------------------------
-- 2b. enrichment_queue is missing its WRITE policy.
--
-- `participants read the queue` ALREADY EXISTS -- shipped by
-- 20260831090000_spotify_foundation.sql:579 -- and `create policy` is not
-- idempotent, so it is not repeated here: doing so would raise 42710 and
-- abort this entire migration file on a hand-run push. Only the write policy
-- is missing, which is what makes the queue write-unreachable today: RLS is
-- already enabled at that same file's line 194, so this does not re-enable
-- it, and the SELECT-only grant below is widened, not replaced.
-- ---------------------------------------------------------------------------

create policy "owner writes own queue" on public.enrichment_queue
  for all using (
    exists (select 1 from public.event_partners p
             where p.id = enrichment_queue.partner_id
               and p.user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.event_partners p
             where p.id = enrichment_queue.partner_id
               and p.user_id = (select auth.uid()))
  );

grant select, insert, update on public.enrichment_queue to authenticated;

-- ---------------------------------------------------------------------------
-- 2c. purge_partner_connection replaced, not amended -- it needs a fourth
-- delete. `create or replace` keeps the existing trigger pointed at this
-- function: a trigger binds to a function by name and signature, not by
-- body, so `event_partners_purge_on_unlink` (created by
-- 20260831090000_spotify_foundation.sql, still live, unchanged here) picks up
-- the new body automatically and needs no re-creation.
-- ---------------------------------------------------------------------------

create or replace function public.purge_partner_connection() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if old.user_id is not null and new.user_id is null then
    delete from public.spotify_tokens      where partner_id = old.id;
    delete from public.spotify_connections where partner_id = old.id;
    delete from public.taste_profiles      where partner_id = old.id;
    -- Omitting this left the previous person's rows in the slot for the next
    -- claimant: unique (partner_id, artist_id) then collides on any shared
    -- artist when sync re-seeds, and stale unsettled rows leave
    -- `settled < total` forever -- "analysing" that never clears.
    delete from public.enrichment_queue    where partner_id = old.id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2d. claim_next_artist (§2.11), new.
--
-- DELIBERATE WIDENING FROM DESIGN §2.11, recorded here and to be amended into
-- §2.11 in the same PR: §2.11's own function signature reads
-- `returns text`, so `.rpc()` would yield `{ data: 'a-1' }` -- a bare string,
-- never an array of rows. An implementation written against the plan's
-- original mock (`[{ spotify_artist_id, name }]`) would index into that
-- string and get `undefined`. enrichment_queue also holds neither an event id
-- nor an artist name, while the enrich-next route needs both. Widened to
-- `table (artist_id text, event_id uuid)`, matching what §2.11's prose (not
-- its pasted signature) actually describes the route consuming.
--
-- Also adds the backoff skip §2.10 promises ("the claim query skips rows
-- whose last_attempt_at falls inside the backoff window") that §2.11's
-- function body never implemented. Without it a transport failure (now
-- non-terminal, per §2.10/§2.11) is re-claimed immediately, forever, for as
-- long as the tab is open -- §2.10 is the authority section here and the
-- retry index exists to serve it.
-- ---------------------------------------------------------------------------

create or replace function public.claim_next_artist(p_partner uuid)
  returns table (artist_id text, event_id uuid)
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- The caller must BE the partner. security definer is here for the row
  -- lock, not to widen who may claim -- and it bypasses RLS, so the policy
  -- that would have refused a stranger no longer applies. The check is
  -- written inline to keep the control where a reader can see it.
  if not exists (select 1 from public.event_partners
                  where id = p_partner and user_id = (select auth.uid())) then
    raise exception 'not your partner row' using errcode = '42501';
  end if;

  return query
  with claimed as (
    update public.enrichment_queue q
       set claimed_at = now()
     where q.id = (
       select q.id from public.enrichment_queue q
        left join public.artist_genres g
               -- Qualified as ep.event_id, not bare event_id: this function's
               -- OUT parameter (returns table (artist_id text, event_id
               -- uuid)) declares a PL/pgSQL variable of that same name, and
               -- an unqualified reference resolves to the VARIABLE, not the
               -- column -- 42P18 "ambiguous", caught only by actually running
               -- this against a live-shaped replica rather than trusting the
               -- design doc's own pasted SQL, which has the same bug.
               on g.event_id = (select ep.event_id from public.event_partners ep
                                 where ep.id = p_partner)
              and g.spotify_artist_id = q.artist_id
        where q.partner_id = p_partner
          and q.settled_at is null
          and (q.claimed_at is null or q.claimed_at < now() - interval '2 minutes')
          and (g.status is distinct from 'failed'
               -- last_attempt_at is nullable, and NULL < anything is NULL, not
               -- true -- a failed row with no recorded attempt time would be
               -- permanently unclaimable without this branch (proven on the
               -- replica: same row claimed instantly as 'pending', stuck
               -- forever as 'failed' + NULL until this line was added).
               or g.last_attempt_at is null
               or g.last_attempt_at < now() - (interval '1 minute' * power(2, least(g.attempts, 5))))
        order by q.position
        limit 1
        -- `of q`, not a bare `for update`: this is a LEFT JOIN, and Postgres
        -- refuses to lock the nullable side of an outer join at all --
        -- "FOR UPDATE cannot be applied to the nullable side of an outer
        -- join", raised only when this actually runs, not at parse time.
        -- The row that needs locking is the queue row being claimed; the
        -- backoff check only READS artist_genres.
        for update of q skip locked)
    returning q.artist_id)
  select c.artist_id, p.event_id
    from claimed c join public.event_partners p on p.id = p_partner;
  -- An empty result set means the queue is drained OR every remaining row is
  -- still inside its own backoff window -- the caller distinguishes the two
  -- by comparing against `settled < total`, not by treating "claimed nothing"
  -- as "done".
end $$;

revoke execute on function public.claim_next_artist(uuid) from public, anon;
grant  execute on function public.claim_next_artist(uuid) to authenticated;
