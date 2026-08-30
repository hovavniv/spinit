/* ---------------------------------------------------------------------------
   Row and page shapes for the event page
   (docs/specs/2026-08-30-event-detail-design.md §6.1).

   Deliberately free of logic and of `import 'server-only'`: the list sections
   are Client Components and import these types, which is exactly why they do
   not live in detailDal.ts (the reasoning src/lib/events/types.ts records).
   --------------------------------------------------------------------------- */

import type { ActionResult } from '@/lib/auth/errors';
import type { CoupleStatus } from '@/lib/dashboard/types';

export type EventSegment = 'ceremony' | 'reception' | 'party';

/** The two segments a DJ can add rows to. Ceremony is written only by its slots. */
export type AddableSegment = Exclude<EventSegment, 'ceremony'>;

export type BlocklistEntryType = 'artist' | 'song' | 'genre';

export interface MustPlayRow {
  id: string;
  segment: EventSegment;
  title: string;
  artist: string | null;
  moment: string | null;
  /** ISO instant. Used for ordering at the query, not rendered. */
  created_at: string;
}

export interface BlocklistRow {
  id: string;
  segment: EventSegment;
  entry_type: BlocklistEntryType;
  value: string;
  created_at: string;
}

/**
 * The state a list form's action returns. `null` is "no submission yet" — an
 * initial `{ ok: true }` would flash "Saved ✓" the moment the page loads.
 *
 * Declared HERE rather than in detailActions.ts so a Client Component never
 * imports anything from a `'use server'` module: a type import is erased at
 * build time and would work, but it leaves a client file importing from a
 * server module, which is a trap for whoever edits it next — the same reason
 * these row types are not in the DAL.
 */
export type DetailActionState = ActionResult | null;

export interface EventDetail {
  id: string;
  couple_names: string;
  couple_status: CoupleStatus;
  notes: string | null;
  mustPlay: MustPlayRow[];
  blocklist: BlocklistRow[];
}
