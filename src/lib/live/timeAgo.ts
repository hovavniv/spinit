/**
 * `now` is an argument and never read from the clock inside, so this is a pure
 * function of its inputs and its tests are deterministic -- the same shape
 * `minutesLeftInPhase` (phaseClock.ts) already uses, and for the same stated
 * reason.
 *
 * Always rounds DOWN, never up: a 119-second-old event reads "1m ago", not
 * "2m ago". This function feeds a feed the DJ reads to understand how recent
 * the room's activity really is -- claiming something happened more recently
 * than it did is the wrong direction to err in.
 */
export function timeAgo(createdAt: string, now: Date): string {
  const elapsedSeconds = Math.floor((now.getTime() - Date.parse(createdAt)) / 1000);

  if (elapsedSeconds < 60) return 'just now';

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours}h ago`;
}
