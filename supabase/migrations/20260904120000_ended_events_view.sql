-- An event is ENDED when the DJ has ended it, or when its date has passed.
--
-- Until now this view meant `status = 'completed'`, and nothing in the
-- application has ever written that value -- only 'draft' on insert and
-- 'upcoming' on promotion. So every wedding stayed upcoming for ever and this
-- view could only ever return seeded rows. See
-- docs/specs/2026-09-03-upcoming-events-design.md §3.5.
--
-- THE STATUS CONJUNCT IS LOAD-BEARING. `event_date < today OR status =
-- 'completed'` -- without `status = 'upcoming'` -- would also admit:
--   * draft rows, including the 170 undeletable ones the RLS suite has leaked
--     (all dated 2026-12-01), which would surface here in one lump on
--     2026-12-02;
--   * cancelled rows, which two tests in src/lib/events/rls.integration.test.ts
--     assert appear neither in this view nor through the recap;
--   * live rows, which are deliberately exempt from the date rule -- a wedding
--     still running at 00:30 must not be filed under Past while the DJ is
--     still playing.
--
-- The name still tells the truth, which the original migration's comment
-- argued for and which still holds: every row here IS a past event. The date
-- says so. `status` has simply stopped being how we know.
--
-- TIMEZONE: `current_date` would be UTC on this host. The application is
-- pinned to Asia/Jerusalem (src/lib/dashboard/now.ts, APP_TIMEZONE). Using
-- both opens a window each night -- two hours in winter, three in summer --
-- where an event is on neither screen: dropped from Upcoming by the app's
-- clock, not yet admitted here by the database's. This expression is DST-aware.
-- If APP_TIMEZONE ever moves, it moves here too.
--
-- `with (security_invoker = on)` IS RESTATED DELIBERATELY. CREATE OR REPLACE
-- VIEW replaces the whole reloptions list; omitting it silently resets the
-- view to its owner's RLS. The owner is `postgres`, which has rolbypassrls, so
-- the omission would return every DJ's ended events to every signed-in DJ.
-- Grants are preserved by CREATE OR REPLACE and are not restated.
create or replace view public.past_events_with_counts
with (security_invoker = on) as
  select e.id, e.dj_id, e.couple_names, e.venue, e.event_date, e.status,
         count(s.id)::int as songs_played
    from public.events e
    left join public.played_songs s on s.event_id = e.id
   where e.status = 'completed'
      or (e.status = 'upcoming'
          and e.event_date < (now() at time zone 'Asia/Jerusalem')::date)
   group by e.id;

-- Not measured, stated: events_dj_status_date_idx (dj_id, status, event_date
-- desc) was described in 20260829171500_events.sql as having "two equality
-- columns lead so the lookup is index-backed". With a disjunction on status
-- that is no longer the shape; only dj_id leads. The planner may still
-- BitmapOr. No EXPLAIN was run -- at this data volume it is not worth one --
-- so this note corrects the claim rather than replacing it with a new one.
