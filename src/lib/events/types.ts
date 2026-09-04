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

/**
 * A month heading and the events under it, in the order they render.
 *
 * Generic because two screens group by month over different row shapes; the
 * default keeps every existing reference to the bare name compiling.
 */
export interface MonthGroup<T = PastEventRow> {
  /** e.g. 'July 2026'. */
  label: string;
  events: T[];
}

/** The 52px date tile at the left of each row: day number over weekday. */
export interface DayTile {
  day: number;
  /** Three letters, upper case, e.g. 'SAT' — the artboard's own format. */
  weekday: string;
}

/**
 * One row of `public.played_songs`, as selected by getEventRecap.
 *
 * `suggested_by` is a guest's display name, not a foreign key. NULL means the
 * DJ's own pick — and so does '', which the column's check constraint
 * permits. Treat "absent" as null-or-blank everywhere; recap.ts has the one
 * predicate that decides it.
 */
export interface PlayedSong {
  position: number;
  title: string;
  artist: string;
  suggested_by: string | null;
}

/** The event half of a recap. */
export interface RecapEvent {
  id: string;
  couple_names: string;
  venue: string;
  /** 'YYYY-MM-DD'. Never pass this to `new Date(string)` — see format.ts. */
  event_date: string;
}

/** Everything /events/[id]/recap renders. */
export interface EventRecap {
  event: RecapEvent;
  songs: PlayedSong[];
}
