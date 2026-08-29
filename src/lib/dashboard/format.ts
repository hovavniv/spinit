/* ---------------------------------------------------------------------------
   Pure formatting/derivation functions for the DJ Dashboard screen
   (design/specs/2026-08-29-dj-dashboard-design.md §6).

   Parsing rule: never construct a Date from a string here. Split it and use
   `new Date(y, m - 1, d, h, min)` (local-time constructor args), or read the
   substring directly (formatStartTime, which never constructs a Date at all).

   Why, precisely — an earlier version of this comment got it wrong and said
   both forms are UTC-parsed. Only the date-only form is. Measured under
   TZ=America/Los_Angeles:

     new Date('2026-07-18')           -> getDate() 17   date-only, UTC-parsed
     new Date('2026-07-18T00:00:00')  -> getDate() 18   date-time, LOCAL
     new Date('2026-07-18T00:00')     -> getDate() 18   date-time, LOCAL

   So 'YYYY-MM-DD' genuinely shifts a day in negative-offset zones, and
   'YYYY-MM-DDTHH:mm' genuinely does not. The rule below is still "never from
   a string", because a convention with one exception is a convention someone
   applies to the wrong case at 2am — but it is a convention we chose, not a
   requirement the language imposes, and it should not be defended as the
   latter.
   --------------------------------------------------------------------------- */

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTHS_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Splits 'YYYY-MM-DDTHH:mm' (or 'YYYY-MM-DD') into a local Date, never via new Date(string). */
function parseLocalDateTime(value: string): Date {
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = (timePart ?? '00:00').split(':').map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0);
}

/**
 * Splits 'YYYY-MM-DD' into a local midnight Date, never via new Date(string).
 * Exported because src/lib/events/pastEvents.ts needs exactly this parser —
 * a third copy of it in this repo would be one more thing to keep in sync.
 */
export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function greeting(now: string): 'Good morning' | 'Good afternoon' | 'Good evening' {
  const hours = parseLocalDateTime(now).getHours();
  if (hours < 12) return 'Good morning';
  if (hours < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatEyebrowDate(now: string): string {
  const d = parseLocalDateTime(now);
  const weekday = WEEKDAYS[d.getDay()];
  const month = MONTHS_FULL[d.getMonth()];
  return `${weekday}, ${month} ${d.getDate()}`;
}

export function daysUntil(eventDate: string, now: string): string | null {
  const event = parseLocalDate(eventDate);
  const today = parseLocalDateTime(now);
  today.setHours(0, 0, 0, 0);

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((event.getTime() - today.getTime()) / msPerDay);

  if (diffDays < 0) return null;
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return `in ${diffDays} days`;
}

export function initials(name: string): string {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length === 1) {
    return tokens[0].charAt(0).toUpperCase();
  }
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

export function formatCardDate(date: string): string {
  const d = parseLocalDate(date);
  return `${MONTHS_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatPastDate(date: string): string {
  const d = parseLocalDate(date);
  return `${MONTHS_FULL[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatStartTime(startedAt: string): string {
  // Reads the HH:mm substring directly out of the ISO string — never
  // constructs a Date — so it renders the event's own local time
  // regardless of what timezone the code runs in.
  const match = startedAt.match(/T(\d{2}):(\d{2})/);
  if (!match) return startedAt;
  const hour24 = Number(match[1]);
  const minute = match[2];
  const period = hour24 < 12 ? 'AM' : 'PM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${minute} ${period}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0];
}
