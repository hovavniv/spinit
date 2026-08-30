-- Columns the DJ Dashboard draws that no other screen needs
-- (docs/specs/2026-08-29-dashboard-data-design.md §4).
--
-- ALTERs public.events, created by feat/past-events' own *_events.sql
-- migration. THIS FILE MUST SORT AFTER *_events.sql. The filename timestamp is
-- a weak, zero-second-margin guard; see step 2 of task 1 in the plan for the
-- real, merge-time check.

create type public.event_phase   as enum ('cocktails', 'dinner', 'open-floor', 'last-dance');
create type public.couple_status as enum ('streaming-connected', 'awaiting-couple');

alter table public.events
  -- Nullable, not `not null default 'cocktails'`: a default would backfill
  -- rows the past-events seed already created — three completed weddings and
  -- one cancelled event permanently recorded as being in the cocktail hour.
  -- A completed wedding has a phase it ended in, which nobody recorded; a
  -- cancelled one never had one. Null is correct for every row that seed
  -- creates. The check below requires it only once status = 'live', and is
  -- evaluated on UPDATE as well as INSERT, so the live transition is a
  -- two-column write or it is rejected.
  add column phase         public.event_phase,
  -- a bare `time`, NOT timestamptz. format.ts's formatStartTime reads the
  -- HH:mm substring with a regex and never constructs a Date, so a timestamptz
  -- would render a venue's 8:00 PM wedding as 5:00 PM UTC. Same reasoning as
  -- event_date being a `date`: a wedding is on a day, at a time, at one place.
  add column start_time    time,
  -- distinct from events.status: that is the event's lifecycle, this is the
  -- couple's preparation, and the two move independently.
  add column couple_status public.couple_status not null default 'awaiting-couple',
  add constraint phase_required_when_live
    check (status <> 'live' or phase is not null);

-- No new policies and no new grants. These columns sit on a table whose four
-- RLS policies already scope every row to its owning DJ, and a column added to
-- a table under RLS inherits that table's policies.
