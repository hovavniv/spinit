import { z } from 'zod';

import { TOKEN_PATTERN } from './token';

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

/**
 * Guest-facing schemas (design §4.5, §4.7, §9). `TOKEN_PATTERN` is imported
 * from `token.ts` rather than re-derived, so the shape checked here and the
 * shape the `join_token_shape` CHECK enforces can never drift apart.
 */
export const joinTokenSchema = z.string().regex(TOKEN_PATTERN);

/**
 * The `[token]` ROUTE PARAM, checked before it is ever used to build a
 * cookie name or query the database -- the same reject-before-use discipline
 * `isUuid` applies to `/events/[id]`. Kept as its own schema (rather than
 * reusing `joinTokenSchema` directly at call sites) so every call site names
 * what it is validating.
 */
export const joinTokenParamSchema = z.string().regex(TOKEN_PATTERN);

/** Mirrors `guest_sessions.display_name_len` (§3.2): trim, 1-40. */
export const guestNameSchema = z.string().trim().min(1).max(40);

/**
 * Mirrors `song_suggestions`' three checks (§3.3). Deliberately has NO
 * artist-id field -- a guest never supplies one (§4.3, §9): adding it back
 * would re-open the fabricated-artist hole the RPC signature was designed to
 * close.
 */
export const guestSuggestSchema = z.object({
  trackId: z.string().regex(TOKEN_PATTERN),
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200),
});

/** `suggestionId` is guest-supplied and reaches an anon RPC (§9). */
export const guestVoteSchema = z.object({
  suggestionId: z.uuid(),
});
