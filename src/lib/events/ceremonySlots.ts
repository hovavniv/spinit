/* ---------------------------------------------------------------------------
   The ceremony slots (docs/specs/2026-08-30-event-detail-design.md §6.3).

   Read by CeremonySongs (to draw the rows, in this order) and by
   saveEventDetails (to resolve each slot's `moment`). The form's fields are
   named by INDEX -- `ceremony-0-title` -- and never carry a moment string, so
   the page cannot be used to write an arbitrary ceremony moment.
   --------------------------------------------------------------------------- */

export const CEREMONY_SLOTS = [
  { moment: 'Walking down the aisle', label: 'Walking down the aisle' },
  { moment: 'Breaking the glass', label: 'Breaking the glass' },
] as const;

export type CeremonySlot = (typeof CEREMONY_SLOTS)[number];
