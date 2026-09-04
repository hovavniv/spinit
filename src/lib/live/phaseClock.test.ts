import { describe, expect, it } from 'vitest';
import { PHASE_MINUTES, minutesLeftInPhase } from './phaseClock';

const START = '2026-09-05T20:00:00.000Z';
const at = (mins: number) => new Date(Date.parse(START) + mins * 60_000);

describe('minutesLeftInPhase', () => {
  it('counts down inside the phase', () => {
    expect(minutesLeftInPhase('dinner', START, at(30))).toBe(PHASE_MINUTES.dinner - 30);
  });

  it('is 0 exactly at the boundary', () => {
    expect(minutesLeftInPhase('dinner', START, at(PHASE_MINUTES.dinner))).toBe(0);
  });

  it('clamps to 0 when the phase has overrun, never negative', () => {
    expect(minutesLeftInPhase('dinner', START, at(PHASE_MINUTES.dinner + 45))).toBe(0);
  });

  // The pre-existing-row case S3.1 chose deliberately. Do not "tidy" this to 0:
  // null means "no phase clock", and 0 means "no time left", which rank.ts
  // treats differently.
  it('returns null when the phase start is unknown', () => {
    expect(minutesLeftInPhase('dinner', null, at(10))).toBeNull();
  });
});
