import { todayInAppTimezone } from '@/lib/dashboard/now';

/**
 * Has this event's date already passed, in APP_TIMEZONE (not the viewer's
 * browser timezone)?
 *
 * Extracted out of `EventDetailScreen.tsx`'s local `alreadyEndedByDate`
 * const, where it silently coupled two features that live in different
 * files and different branches: `EndEventSection`'s `canEnd` (an upcoming
 * event past its date has already ended, so no End button) and
 * `StartEventSection`'s `canStart` (the same date rule stops a DJ from
 * un-ending an ended event by pressing Start). Reading either section's file
 * in isolation gave no signal that the other depended on the identical
 * expression -- two predicates answering "has this date passed" is how they
 * would drift apart. Named and exported so both consumers import the same
 * function instead.
 *
 * `clock` is a parameter, the same injectable-clock shape `now.ts` uses, so
 * tests pin an instant instead of mocking global time.
 */
export function hasEventDatePassed(eventDate: string, clock: Date = new Date()): boolean {
  return eventDate < todayInAppTimezone(clock);
}
