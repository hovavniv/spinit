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
  /**
   * Local wall clock, 'YYYY-MM-DDTHH:mm', with NO offset and no trailing 'Z'.
   *
   * Composed by fromDb.ts from the event's `event_date` and `start_time`
   * columns. `formatStartTime` reads the HH:mm substring with a regex and
   * never constructs a Date, so this string is rendered verbatim — which is
   * why the column is a bare `time` rather than a timestamptz, and why an
   * offset here would be wrong rather than merely redundant
   * (docs/specs/2026-08-29-dashboard-data-design.md §4).
   */
  startedAt: string;
};

/**
 * A union rather than a boolean: the artboard already draws these states
 * differently, and more are coming (do-not-play list pending, guest list
 * missing) that a boolean would have to be widened to fit.
 *
 * 'partly-connected' is rendered as "1 of 2 connected" on /events/upcoming and
 * folded into the grey "Awaiting couple" pill on /dashboard, whose artboard
 * draws only two variants. That divergence is deliberate and recorded in the
 * design's §3.2; DashboardScreen.test.tsx pins the dashboard half.
 */
export type CoupleStatus = 'streaming-connected' | 'partly-connected' | 'awaiting-couple';

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
