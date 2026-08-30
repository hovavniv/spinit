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

export interface PartnerRow {
  id: string;
  slot: 1 | 2;
  display_name: string;
  /** Null between the DJ sending the invite and the partner claiming the slot. */
  user_id: string | null;
}

/**
 * Who is looking at the event page (design §4). Resolved on the server in
 * page.tsx and passed down; null means "neither", which the route turns into
 * notFound() — never a 403, which would confirm the id is real and turn the
 * route into an oracle for enumerating event ids.
 */
export type Viewer = { role: 'dj' } | { role: 'partner'; partnerId: string };

export interface EventDetail {
  id: string;
  /** The owner. The route needs it to resolve the viewer (design §4). */
  dj_id: string;
  couple_names: string;
  couple_status: CoupleStatus;
  /**
   * The two note bodies (design §3, §5.2). Strings, never null: both tables
   * default the body to '' and the migration backfills a row per event.
   *
   * `privateNotes` is '' for a partner because their read returns no row at
   * all — the policy filters it. That is the boundary working, not an error.
   */
  privateNotes: string;
  sharedNotes: string;
  partners: PartnerRow[];
  mustPlay: MustPlayRow[];
  blocklist: BlocklistRow[];
}
