import { describe, expect, it } from 'vitest';
import { GENRES } from '@/lib/genres/vocabulary';
import { PHASE_GENRES, PHASE_SEGMENT, START_PHASE } from './phaseSegment';

describe('PHASE_SEGMENT', () => {
  it('maps every phase to a segment the queue can contain', () => {
    expect(PHASE_SEGMENT).toEqual({
      dinner: 'reception',
      'open-floor': 'party',
    });
  });

  // Ceremony songs are driven by the two cue cards, not the queue, so no phase
  // maps to them (S6.2-i).
  it('never maps a phase to the ceremony segment', () => {
    expect(Object.values(PHASE_SEGMENT)).not.toContain('ceremony');
  });

  // Asserting `START_PHASE` equals a literal would survive the enum rename
  // already parked in supabase/migrations/_pending/, and would pass even if
  // the segment it resolves to silently inverted. What matters is that a
  // starting event honours the couple's RECEPTION rules, not which string is
  // stored to get there.
  it('resolves the starting phase to the reception segment', () => {
    expect(PHASE_SEGMENT[START_PHASE]).toBe('reception');
  });
});

describe('PHASE_GENRES', () => {
  // A token that is not in the vocabulary fails completely silently -- the term
  // just never fires. Same failure shape as a misspelled CSS custom property,
  // which CLAUDE.md records as having shipped once already.
  it('uses only tokens that exist in the genre vocabulary', () => {
    const vocabulary = new Set<string>(GENRES);
    for (const [phase, { wants, avoids }] of Object.entries(PHASE_GENRES)) {
      for (const token of [...wants, ...avoids]) {
        expect(vocabulary.has(token), `${phase}: "${token}" is not in GENRES`).toBe(true);
      }
    }
  });
});
