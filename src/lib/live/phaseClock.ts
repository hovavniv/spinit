import type { EventPhase } from '@/lib/dashboard/types';

/**
 * A stated default, not configuration. A DJ-editable schedule is a settings
 * screen, a migration and a validation surface for a number that only nudges
 * one ranking term. Recorded here so the next agent does not treat these as
 * arbitrary and quietly change them (S5.4).
 */
/**
 * Collapsed 2026-09-06 from four phases to two; each entry is the sum of the
 * two former phases sharing its segment (docs/specs/2026-09-06-two-phases-spec.md).
 * Behaviour change worth flagging: term 7 (phase-ending must-play) boosts an
 * unplayed must-play when fewer than 15 minutes remain in the phase.
 * Previously 'last-dance' was only 20 minutes long, so that boost fired for
 * three quarters of it. Now it fires only in the final 15 minutes of a
 * 140-minute 'open-floor' phase -- a real change in when the engine gets
 * urgent about unplayed must-plays, not merely a relabelling.
 */
export const PHASE_MINUTES: Record<EventPhase, number> = {
  dinner: 135, // cocktails 60 + dinner 75
  'open-floor': 140, // open floor 120 + last dance 20
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
