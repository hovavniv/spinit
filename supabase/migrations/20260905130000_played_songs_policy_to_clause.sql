-- M3 (pre-push review of feat/live-event): "dj or partner selects songs of
-- event" on public.played_songs (20260905000000_live_event.sql) was created
-- with no `to` clause, so it applies to PUBLIC rather than `authenticated`.
--
-- Inert as things stand -- `revoke all on public.played_songs from anon`
-- (also in that migration) still holds, so `anon` can never actually use
-- this policy. But the design for this slice explicitly adopted the
-- opposite rule after review: "`to authenticated` is written explicitly on
-- every policy." The other three guest-table policies added in the SAME
-- migration all carry it; this one alone was missed. Fixed here as an
-- appended migration rather than an edit to the already-pushed file.
--
-- `alter policy ... to` (not drop+create) keeps the policy's identity and
-- its USING clause untouched -- only the role list changes. Supported since
-- Postgres 9.5; this project targets Postgres 17 (supabase/config.toml).
alter policy "dj or partner selects songs of event" on public.played_songs
  to authenticated;
