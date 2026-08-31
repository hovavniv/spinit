-- Song and artist identity on the two list tables
-- (docs/specs/2026-08-30-spotify-integration-design.md §5.2, §5.6).
--
-- PART ONE OF TWO. This migration only ADDS columns, nullable, with their shape
-- constraints. It changes nothing about what existing code may write, so the
-- application keeps working unchanged after it lands. The deletes, the not-null
-- and the index swap are in the second migration, which runs only after every
-- write path supplies an id.
--
-- The split is deliberate and it is not tidiness. Two existing writes insert
-- into event_must_play with no id -- addMustPlay and saveEventDetails' ceremony
-- branch -- and both would violate a not-null the instant it landed, staying
-- broken until the pickers are wired several tasks later. Someone hitting that
-- red tree is tempted to make the column nullable to get green again, which
-- discards the constraint the whole slice exists to add.
--
-- Every entry becomes PICKED from Spotify rather than typed, because the
-- decision engine cannot reason about a string: "already suggested" is an id
-- comparison, "this artist repeated two songs ago" needs an artist id, and
-- "the couple banned this" needs the ban and the candidate to be one value
-- rather than two spellings.

alter table public.event_must_play
  add column spotify_track_id  text,
  add column spotify_artist_id text;

alter table public.event_blocklist
  add column spotify_id text;

-- Shape constraints land NOW, while the columns are still nullable, so they
-- validate against an empty set and can never fail on existing data. §7
-- validates the same regex in zod, but a participant holds table-level
-- insert/update grants on both tables and can PATCH PostgREST directly, so zod
-- is not the control.
alter table public.event_must_play
  add constraint must_play_track_id_shape
    check (spotify_track_id is null
           or spotify_track_id ~ '^[A-Za-z0-9]{22}$'),
  add constraint must_play_artist_id_shape
    check (spotify_artist_id is null
           or spotify_artist_id ~ '^[A-Za-z0-9]{22}$');

alter table public.event_blocklist
  add constraint blocklist_spotify_id_shape
    check (spotify_id is null or spotify_id ~ '^[A-Za-z0-9]{22}$');

-- ---------------------------------------------------------------------------
-- Removing surface the service-role reversal left behind.
--
-- Plan A's migration is merged and live. It created a `security definer`
-- function with a write path into artist_genres, and granted DML on three
-- tables to service_role. The design that asked for both was then reversed: the
-- genre cache is scoped per event, the enrichment poll is authorized to the
-- owning partner, and this project holds no service-role key. So NOTHING calls
-- this function and NO CODE RUNS as that role.
--
-- Dead is not harmless. A definer function nobody invokes is exactly what
-- survives three refactors and then gets granted to `authenticated` by someone
-- who assumes it must be needed -- which is not hypothetical: it is what the
-- fourth review caught in revision 4 of the design. Better that it does not
-- exist than that nobody re-grants it.
--
-- Verified live before writing this: the function is present with prosecdef
-- true, granted to service_role and postgres.
--
-- The third stranded item -- artist_genres still being GLOBAL rather than
-- event-scoped -- is NOT here. That is a real schema change (a new column, a
-- new primary key, a new policy) and it belongs to Plan C's migration next to
-- the code that depends on it. These two are pure removals with no dependency
-- on C, so they cost nothing to do now and they remove the surface sooner.
drop function if exists public.upsert_artist_genres(
  text, text, text, text, jsonb, jsonb, jsonb,
  public.enrichment_status, public.enrichment_route);

revoke all on public.artist_genres, public.enrichment_queue, public.taste_profiles
  from service_role;

-- Pre-existing, not introduced here, folded in because this is the natural place.
-- The foundation migration revoked TRUNCATE from service_role on its eight tables;
-- the six OLDER tables were only ever hardened against anon and authenticated, so
-- service_role still holds TRUNCATE on them -- and TRUNCATE bypasses RLS.
--
-- The recurring failure mode again: a control closed on one surface and left open
-- on the adjacent one. event_song_lists.sql's own comment says these tables "must
-- not be laxer than the ones beside them", and they now are.
revoke truncate on
  public.events, public.profiles, public.played_songs,
  public.event_must_play, public.event_blocklist
  from service_role;
