/* ---------------------------------------------------------------------------
   Pure row-to-props mappers for the DJ Dashboard
   (docs/specs/2026-08-29-dashboard-data-design.md §6).

   No React, no Supabase, no clock — the same shape as lib/validation.ts and
   lib/heroDemo.ts. This is where this slice's logic lives, so this is where
   its tests point.
   --------------------------------------------------------------------------- */

import type {
  CoupleStatus,
  EventPhase,
  LiveEvent,
} from './types';

/** A row of `public.events`, as this branch selects it (design §5). */
export interface DashboardEventRow {
  id: string;
  couple_names: string;
  venue: string;
  event_date: string; // 'YYYY-MM-DD'
  status: 'draft' | 'upcoming' | 'live' | 'completed' | 'cancelled';
  phase: EventPhase | null;
  start_time: string | null; // 'HH:mm:ss'
  couple_status: CoupleStatus;
}

/**
 * The one live event, or null.
 *
 * Design §6's rule is "the single row with `status === 'live'` AND a non-null
 * `start_time`" — both conditions are checked together while searching, not
 * `.find(r => r.status === 'live')` followed by a separate null check.
 * Nothing in the schema forbids two `live` rows (no partial unique index, no
 * check constraint), and with ascending `event_date` ordering the naive
 * two-step version would return the earlier row and — if that one had a null
 * `start_time` — the genuinely live event would never show a banner.
 *
 * A `live` row with a null `start_time` is inconsistent data: the banner would
 * read "started at " with nothing after it. Likewise a `live` row with a null
 * `phase`: the schema's `phase_required_when_live` check constraint (design
 * §4) makes this impossible at the database layer, but `DashboardEventRow`
 * types `phase` as `EventPhase | null` because every other status permits
 * null, and this function does not trust a constraint it cannot see. Either
 * case is treated as not-live and logged, rather than rendered, but only when
 * it is the reason nothing qualifies — a broken live row that is shadowed by
 * a genuine one is not an error worth logging. Stated because "it can't
 * happen" is how it happens.
 */
export function toLiveEvent(rows: DashboardEventRow[]): LiveEvent | null {
  const liveRows = rows.filter((row) => row.status === 'live');
  const live = liveRows.find(
    (row): row is DashboardEventRow & { phase: EventPhase; start_time: string } =>
      row.phase !== null && row.start_time !== null,
  );

  if (live === undefined) {
    if (liveRows.length > 0) {
      console.error('toLiveEvent: live event has no phase or no start_time; not rendering the banner', {
        eventId: liveRows[0].id,
      });
    }
    return null;
  }

  return {
    id: live.id,
    coupleNames: live.couple_names,
    venue: live.venue,
    phase: live.phase,
    // 'HH:mm:ss' -> 'HH:mm'. Composed as a bare local wall clock with no
    // offset, which is what formatStartTime's regex reads (design §4).
    startedAt: `${live.event_date}T${live.start_time.slice(0, 5)}`,
  };
}
