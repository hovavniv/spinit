import type { EventPhase } from '@/lib/dashboard/types';

/**
 * A stated default, not configuration. A DJ-editable schedule is a settings
 * screen, a migration and a validation surface for a number that only nudges
 * one ranking term. Recorded here so the next agent does not treat these as
 * arbitrary and quietly change them (S5.4).
 */
export const PHASE_MINUTES: Record<EventPhase, number> = {
  cocktails: 60,
  dinner: 75,
  'open-floor': 120,
  'last-dance': 20,
};

/**
 * `now` is an argument and never read from the clock inside, so this is a pure
 * function of its inputs and its tests are deterministic -- the shape
 * `recap.ts` and `pastEvents.ts` already have.
 *
 * Returns null when `phaseStartedAt` is null: that is "no phase clock", which
 * is a different fact from "no time left" and rank.ts drops the term rather
 * than guessing.
 */
export function minutesLeftInPhase(
  phase: EventPhase,
  phaseStartedAt: string | null,
  now: Date,
): number | null {
  if (phaseStartedAt === null) return null;
  const elapsed = (now.getTime() - Date.parse(phaseStartedAt)) / 60_000;
  return Math.max(0, Math.round(PHASE_MINUTES[phase] - elapsed));
}
