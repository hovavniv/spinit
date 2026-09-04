/* ---------------------------------------------------------------------------
   Pure filter and labels for the Upcoming events screen
   (docs/specs/2026-09-03-upcoming-events-design.md §5.1).

   Ported from the `<script type="text/x-dc">` block of
   `Spinit Upcoming Events.dc.html`. No React, no Supabase, no clock.

   Grouping is NOT here: groupByMonth in ./pastEvents.ts already does it, and
   a second copy would be one more thing to keep in sync.
   --------------------------------------------------------------------------- */

import type { CoupleStatus, UpcomingEvent } from '@/lib/dashboard/types';

/** 'all' plus one per CoupleStatus — the artboard's four pills. */
export type StatusFilter = 'all' | CoupleStatus;

/**
 * The filter pills, as data rather than four hard-coded buttons.
 *
 * Kept separate from BADGE_LABELS even though two labels coincide: this list
 * needs an 'all' entry a badge cannot have, and BADGE_LABELS being a
 * Record<CoupleStatus, string> is what makes tsc catch a fourth status added
 * later. Two small maps beat one map plus a cast.
 */
export const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'streaming-connected', label: 'Streaming connected' },
  { key: 'partly-connected', label: '1 of 2 connected' },
  { key: 'awaiting-couple', label: 'No profiles connected' },
];

/** The badge on each row. */
export const BADGE_LABELS: Record<CoupleStatus, string> = {
  'streaming-connected': 'Streaming connected',
  'partly-connected': '1 of 2 connected',
  'awaiting-couple': 'No profiles connected',
};

/**
 * Search and status filter in one pass, because they compose: a DJ can search
 * "Cedar" AND filter to "No profiles connected". The query rule is identical
 * to filterPastEvents — trimmed, lower-cased, substring over couple names or
 * venue, with an empty query matching everything.
 */
export function filterUpcomingEvents(
  events: UpcomingEvent[],
  query: string,
  filter: StatusFilter,
): UpcomingEvent[] {
  const needle = query.trim().toLowerCase();

  return events.filter((event) => {
    if (filter !== 'all' && event.status !== filter) return false;
    if (needle === '') return true;
    return (
      event.coupleNames.toLowerCase().includes(needle) ||
      event.venue.toLowerCase().includes(needle)
    );
  });
}
