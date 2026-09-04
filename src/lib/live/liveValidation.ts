import { z } from 'zod';

/**
 * Zod schemas for this slice only (design §9). They live here rather than in
 * `src/lib/validation.ts` because that file belongs to `feat/upcoming-events`
 * this week -- this avoids a merge conflict entirely rather than risking one.
 */

const phaseField = z.enum(['cocktails', 'dinner', 'open-floor', 'last-dance']);

export const startEventSchema = z.object({
  eventId: z.uuid(),
  phase: phaseField,
});

export const setPhaseSchema = z.object({
  eventId: z.uuid(),
  phase: phaseField,
});
