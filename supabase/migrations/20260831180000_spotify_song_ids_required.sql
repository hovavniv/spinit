-- PART TWO OF TWO (see 20260831140000). Every write path now supplies an id, so
-- identity can become mandatory.
--
-- Live baseline measured immediately before this migration was authored:
--   event_must_play   5 total, 4 with a real spotify_track_id, 1 without
--   event_blocklist   2 artist (1 with spotify_id, 1 without), 1 song (with
--                     spotify_id), 0 genre
-- so this delete is expected to remove exactly 1 row from event_must_play and
-- exactly 1 row from event_blocklist, on live, when it runs.

-- The columns have been nullable since part one. Every row without an id is a
-- row written before the picker existed -- B10's schemas and B11's wiring are
-- the only write paths left, and both always supply one. It also removes any
-- id-less ceremony-slot row, so that slot reverts to empty and
-- saveEventDetails takes its insert branch -- which now supplies a track id.
-- No foreign key targets this table, so nothing is orphaned.
delete from public.event_must_play where spotify_track_id is null;
alter table public.event_must_play alter column spotify_track_id set not null;

-- `is null or` is now dead weight: the column cannot be null.
alter table public.event_must_play drop constraint must_play_track_id_shape;
alter table public.event_must_play
  add constraint must_play_track_id_shape
    check (spotify_track_id ~ '^[A-Za-z0-9]{22}$');

-- Genre entries survive: they never carry an id and the constraint admits them.
-- Artist and song entries written before the picker do not.
delete from public.event_blocklist
 where entry_type in ('artist', 'song') and spotify_id is null;

alter table public.event_blocklist add constraint blocklist_id_matches_type check (
     (entry_type = 'genre'            and spotify_id is null)
  or (entry_type in ('artist','song') and spotify_id is not null)
);

-- Two identity schemes, because there are two genuinely different KINDS of
-- entry -- not two spellings of one kind. The old text index cannot carry the
-- picked entries: their identity is the id, and a hand-typed 'Nickelback' and a
-- picked Nickelback would not collide under it.
drop index public.event_blocklist_unique_value_idx;

create unique index event_blocklist_spotify_idx
  on public.event_blocklist (event_id, segment, entry_type, spotify_id)
  where spotify_id is not null;

create unique index event_blocklist_genre_idx
  on public.event_blocklist (event_id, segment, lower(value))
  where entry_type = 'genre';
