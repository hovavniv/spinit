/* ---------------------------------------------------------------------------
   Prop shapes for the DJ Dashboard screen (design/specs/2026-08-29-dj-dashboard-design.md §5).

   All components are pure functions of these types — nothing reads a clock,
   a route, or a store. `now` and every date/instant field below is a plain
   string rather than a `Date`, so the exact wire format matters: see the
   comment on each field.
   --------------------------------------------------------------------------- */

export type DjProfile = { name: string; company: string };

/**
 * The enumerated concept the decision engine crosses (CLAUDE.md: "the current
 * event phase" is one of the ranking inputs) — typed as a union, not `string`,
 * because that is exactly the field where losing the enum would hurt most.
 */
export type EventPhase = 'cocktails' | 'dinner' | 'open-floor' | 'last-dance';

export type LiveEvent = {
  id: string;
  coupleNames: string;
  venue: string;
  phase: EventPhase;
  /** Full ISO instant WITH an explicit offset, e.g. '2026-08-27T20:00:00-07:00'. */
  startedAt: string;
};

/**
 * A union rather than a boolean: the artboard already draws these two states
 * differently (filled teal vs. outlined grey), and more states are coming
 * (do-not-play list pending, guest list missing) that a boolean would have to
 * be widened to fit.
 */
export type CoupleStatus = 'streaming-connected' | 'awaiting-couple';

export type UpcomingEvent = {
  id: string;
  coupleNames: string;
  venue: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  status: CoupleStatus;
};

export type PastEvent = {
  id: string;
  coupleNames: string;
  venue: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  songsPlayed: number;
};

export type DashboardData = {
  dj: DjProfile;
  /** 'YYYY-MM-DDTHH:mm', local wall-clock — no offset, no trailing 'Z'. */
  now: string;
  /** null hides the live-event banner (the artboard's `hasLiveEvent` prop). */
  liveEvent: LiveEvent | null;
  upcoming: UpcomingEvent[];
  past: PastEvent[];
};

/** Display text for EventPhase; 'open-floor' → 'Open floor' reproduces the artboard. */
export const PHASE_LABELS: Record<EventPhase, string> = {
  cocktails: 'Cocktails',
  dinner: 'Dinner',
  'open-floor': 'Open floor',
  'last-dance': 'Last dance',
};
