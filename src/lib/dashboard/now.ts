/* ---------------------------------------------------------------------------
   The one place a wall-clock `now` string is produced
   (docs/specs/2026-08-29-dashboard-data-design.md §6).

   Why this file exists at all: `new Date()` in a server component on Vercel is
   UTC. `greeting()` and `formatEyebrowDate()` in format.ts take a local
   wall-clock string, so a UTC clock tells a DJ in Tel Aviv "Good morning" at
   nine in the evening.
   --------------------------------------------------------------------------- */

/**
 * Known limitation, stated rather than hidden: every DJ is assumed to be in
 * one timezone. The fix is a `timezone` column on `profiles` plus UI to set
 * it — a later slice, whose default would be this constant anyway.
 */
export const APP_TIMEZONE = 'Asia/Jerusalem';
// Duplicated in SQL by 20260904120000_ended_events_view.sql — see todayInAppTimezone.

const FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Returns 'YYYY-MM-DDTHH:mm' in APP_TIMEZONE — exactly the shape
 * `DashboardData.now` documents and `format.ts` parses.
 *
 * `clock` is a parameter so tests inject an instant instead of mocking global
 * time. Production always calls it with no argument.
 */
export function currentLocalNow(clock: Date = new Date()): string {
  const parts = FORMATTER.formatToParts(clock);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;

  // `en-CA` gives 2-digit, zero-padded parts, so no manual padding is needed.
  // `hour12: false` resolves to `hourCycle: 'h23'`, which yields '00' at
  // midnight (verified in en-CA, en-US and en-GB) — only an explicit
  // `hourCycle: 'h24'` yields '24'. No fallback branch here: a branch with
  // zero possible coverage is a branch no test can honestly guard (design §4
  // makes exactly this argument about `phase`, and an earlier version of this
  // task wrote precisely the branch it warns against).
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Today's date in APP_TIMEZONE as 'YYYY-MM-DD'.
 *
 * Built on currentLocalNow and FORWARDING its `clock` parameter, which is the
 * only reason this is testable: a version calling `new Date()` itself could
 * not be pinned to an instant where UTC and Jerusalem disagree about the date.
 *
 * The migration `20260904120000_ended_events_view.sql` hard-codes the same
 * timezone in SQL, because a view body cannot import this constant. If
 * APP_TIMEZONE ever moves, that migration moves with it.
 */
export function todayInAppTimezone(clock: Date = new Date()): string {
  return currentLocalNow(clock).slice(0, 10);
}
