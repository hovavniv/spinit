import type { EventPhase } from '@/lib/dashboard/types';
import type { EventSegment } from '@/lib/events/detailTypes';

/**
 * The couple's must-play and do-not-play lists are per SEGMENT; the engine
 * reasons in PHASES. `event_blocklist`'s unique index is
 * (event_id, segment, entry_type, spotify_id), so the same artist can
 * legitimately be blocked in one segment and allowed in another -- that is
 * deliberate, and honouring it is the point of this map (S6.2-i).
 *
 * 'ceremony' is deliberately absent from the range: it happens before any phase
 * in this enum, and its songs are driven by the two CEREMONY_SLOTS cues rather
 * than by the queue.
 */
export const PHASE_SEGMENT: Record<EventPhase, EventSegment> = {
  cocktails: 'reception',
  dinner: 'reception',
  'open-floor': 'party',
  'last-dance': 'party',
};

/**
 * Every token here MUST exist in `vocabulary.ts`'s GENRES -- the test above
 * asserts it. An earlier draft used 'acoustic', 'bossa nova' and 'ballad',
 * none of which exist, which would have left term 6 half-dead in three of four
 * phases with no error anywhere.
 */
export const PHASE_GENRES: Record<EventPhase, { wants: string[]; avoids: string[] }> = {
  cocktails: {
    wants: ['jazz', 'swing', 'soul', 'blues', 'folk'],
    avoids: ['metal', 'techno', 'dubstep', 'punk'],
  },
  dinner: {
    wants: ['soul', 'jazz', 'blues', 'gospel', 'classical'],
    avoids: ['techno', 'trance', 'edm', 'metal', 'dubstep', 'drum and bass'],
  },
  'open-floor': {
    wants: ['pop', 'dance-pop', 'disco', 'funk', 'house', 'mizrahi', 'hafla', 'edm'],
    avoids: ['classical', 'ambient', 'opera'],
  },
  'last-dance': {
    wants: ['rock', 'classic rock', 'soul', 'pop', 'hora'],
    avoids: ['techno', 'dubstep'],
  },
};
