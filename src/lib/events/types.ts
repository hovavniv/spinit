/* ---------------------------------------------------------------------------
   Shapes for the Past events screen
   (docs/specs/2026-08-29-past-events-design.md §6, §7).

   These live in their own file rather than in dal.ts because dal.ts starts
   with `import 'server-only'` and PastEventsList is a client component. A
   type-only import would be erased at build time and would work, but it
   leaves a client file importing from a server-only module, which is a trap
   for whoever edits it next.
   --------------------------------------------------------------------------- */

/** One row of `public.past_events_with_counts`, as selected by listPastEvents. */
export interface PastEventRow {
  id: string;
  couple_names: string;
  venue: string;
  /** 'YYYY-MM-DD'. Never pass this to `new Date(string)` — see format.ts. */
  event_date: string;
  songs_played: number;
}

/** A month heading and the events under it, in the order they render. */
export interface MonthGroup {
  /** e.g. 'July 2026'. */
  label: string;
  events: PastEventRow[];
}

/** The 52px date tile at the left of each row: day number over weekday. */
export interface DayTile {
  day: number;
  /** Three letters, upper case, e.g. 'SAT' — the artboard's own format. */
  weekday: string;
}
