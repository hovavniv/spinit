-- Close a gap in 20260829171500_events.sql: that migration's revoke line named
-- only public.events and public.played_songs, not the view built on top of
-- them, so past_events_with_counts kept the hosted project's default
-- authenticated=Dxtm alongside the intended select. Found 2026-08-29 by an
-- independent re-verification of the earlier migration's live ACLs.
--
-- No data-access consequence: TRUNCATE and MAINTAIN are inert on a
-- non-materialised view, REFERENCES cannot target a view, and TRIGGER
-- additionally needs CREATE on schema public, which authenticated holds only
-- USAGE on (verified against pg_namespace when 20260829171500 was written).
-- PostgREST has no verb for any of the four. This migration exists because
-- the earlier one argued "must not be laxer than profiles" for exactly this
-- revoke on the two tables, and the same argument applies to the view.
revoke truncate, references, trigger, maintain on public.past_events_with_counts
  from anon, authenticated;
