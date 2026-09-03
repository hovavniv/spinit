-- Columns the New Event wizard writes
-- (docs/specs/2026-09-02-new-event-design.md §3.1).
--
-- ALTERs public.events, created by 20260829171500_events.sql. This file must
-- sort after it; it does.
--
-- All three nullable with no default. Every existing row -- three seeded
-- completed weddings and one cancelled event -- has a guest count nobody
-- recorded and a couple_names nobody ever split. Backfilling either would be
-- inventing data. Same reasoning 20260830000000_event_phase.sql applies to
-- `phase`.
--
-- partner1_name/partner2_name are the INPUT that produced couple_names;
-- couple_names stays the display string every other screen reads. Storing
-- both is a deliberate, small duplication: splitting "A & B" back apart is
-- silently wrong for a name containing '&', for different spacing, and for
-- "Ben & Jerry & Dana" -- and it fails with no error, which is the worst
-- failure shape available (design §3.3).
--
-- No new policies and no new grants: a column added to a table under RLS
-- inherits that table's policies, and events' grant is table-level (verified
-- in step 1 above), so it covers columns added later.
alter table public.events
  add column guest_count   int,
  add column partner1_name text,
  add column partner2_name text,
  -- 10000 is a sanity ceiling to stop a typo becoming a nonsense number.
  -- It is not a product limit.
  add constraint guest_count_range
    check (guest_count is null or guest_count between 1 and 10000),
  -- 120 repeats couple_names_len's own bound, so a name that fits here can
  -- always compose into a couple_names that fits there.
  add constraint partner1_name_len
    check (partner1_name is null or char_length(partner1_name) between 1 and 120),
  add constraint partner2_name_len
    check (partner2_name is null or char_length(partner2_name) between 1 and 120);
