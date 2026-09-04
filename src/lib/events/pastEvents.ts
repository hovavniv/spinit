/* ---------------------------------------------------------------------------
   Pure filter/group/format functions for the Past events screen
   (docs/specs/2026-08-29-past-events-design.md §7).

   Ported from the `<script type="text/x-dc">` block of
   design/artboards/Spinit Past Events.dc.html. No React, no Supabase, no
   clock — everything here is a function of its arguments, which is what makes
   it cheap to test.
   --------------------------------------------------------------------------- */

import { parseLocalDate, MONTHS_FULL } from '@/lib/dashboard/format';
import type { PastEventRow, MonthGroup, DayTile } from './types';

// WEEKDAYS_SHORT is NOT shared: format.ts has no equivalent, and the day-tile
// abbreviation is this screen's own. MONTHS_FULL is imported rather than
// copied -- format.ts already holds the identical array (Task 1 exports it).
const WEEKDAYS_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * Case-insensitive substring match on couple names OR venue, over the trimmed
 * query. An empty or whitespace-only query returns the input unchanged.
 * Matches the artboard's own filter one-for-one.
 */
export function filterPastEvents(events: PastEventRow[], query: string): PastEventRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return events;

  return events.filter(
    (event) =>
      event.couple_names.toLowerCase().includes(needle) ||
      event.venue.toLowerCase().includes(needle),
  );
}

/**
 * Groups events under a 'Month YYYY' heading, preserving input order: a
 * month's group appears at the position of its first event, and events keep
 * their relative order inside it.
 *
 * PRECONDITION: `events` is already sorted by date. This function does not
 * sort. Two callers rely on it, in opposite directions: listPastEvents orders
 * event_date DESCENDING, listActiveEvents ASCENDING. Given unsorted input it
 * produces groups in whatever order the input happened to be in, and the same
 * month can appear twice.
 */
export function groupByMonth<T>(events: T[], dateOf: (event: T) => string): MonthGroup<T>[] {
  const byKey = new Map<string, MonthGroup<T>>();
  const order: string[] = [];

  for (const event of events) {
    const date = parseLocalDate(dateOf(event));
    const key = `${date.getFullYear()}-${date.getMonth()}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        label: `${MONTHS_FULL[date.getMonth()]} ${date.getFullYear()}`,
        events: [],
      });
      order.push(key);
    }
    byKey.get(key)!.events.push(event);
  }

  return order.map((key) => byKey.get(key)!);
}

/** The 52px date tile: day number over three-letter weekday, e.g. 18 / SAT. */
export function dayTile(date: string): DayTile {
  const d = parseLocalDate(date);
  return { day: d.getDate(), weekday: WEEKDAYS_SHORT[d.getDay()] };
}
