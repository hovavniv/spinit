/**
 * The event's display name, composed from the two names step 1 collects
 * (docs/specs/2026-09-02-new-event-design.md §3.3).
 *
 * A PLAIN MODULE, deliberately not part of newEventActions.ts. Every export of
 * a `'use server'` module must be an async function; a synchronous helper
 * exported from one fails `next build` while lint, typecheck and every unit
 * test stay green. This repo has already shipped fifteen commits with that
 * defect (src/app/dev/paste-code/actions.ts).
 *
 * There is NO inverse. Composition runs one direction only, and the two names
 * are read back from events.partner1_name/partner2_name, never by splitting
 * this string.
 */
export function composeCoupleNames(partner1: string, partner2: string): string {
  return `${partner1.trim()} & ${partner2.trim()}`;
}
