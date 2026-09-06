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
  // Historical enum labels. 'dinner' IS the reception phase and 'open-floor' IS
  // the party phase -- the DJ never sees these strings. Renaming the enum needs
  // two migrations (Postgres will not let ALTER TYPE ... ADD VALUE be used in
  // the transaction that adds it); the migration is written and waiting in
  // supabase/migrations/_pending/. Until it runs, this map is the only place
  // that says what the labels mean.
  dinner: 'reception',
  'open-floor': 'party',
};

/**
 * Every event begins at the reception. Stored as 'dinner' because that is the
 * historical enum label this phase kept -- see PHASE_SEGMENT above.
 */
export const START_PHASE: EventPhase = 'dinner';

/**
 * Every token here MUST exist in `vocabulary.ts`'s GENRES -- the test above
 * asserts it. An earlier draft used 'acoustic', 'bossa nova' and 'ballad',
 * none of which exist, which would have left term 6 half-dead in three of four
 * phases with no error anywhere.
 *
 * Collapsed 2026-09-06 from four phases to two (see PHASE_SEGMENT's comment):
 * each entry below is the union of the two former phases that shared its
 * segment. 'soul' appeared in BOTH former reception phases (cocktails,
 * dinner) but in only ONE former party phase (last-dance, not open-floor);
 * it is kept in reception only, where every constituent phase wanted it.
 */
export const PHASE_GENRES: Record<EventPhase, { wants: string[]; avoids: string[] }> = {
  dinner: {
    wants: ['jazz', 'swing', 'soul', 'blues', 'folk', 'gospel', 'classical'],
    avoids: ['metal', 'techno', 'dubstep', 'punk', 'trance', 'edm', 'drum and bass'],
  },
  'open-floor': {
    wants: [
      'pop',
      'dance-pop',
      'disco',
      'funk',
      'house',
      'mizrahi',
      'hafla',
      'edm',
      'rock',
      'classic rock',
      'hora',
    ],
    avoids: ['classical', 'ambient', 'opera', 'techno', 'dubstep'],
  },
};
