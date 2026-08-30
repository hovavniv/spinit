import { describe, expect, it, afterEach } from 'vitest';
import { APP_TIMEZONE, currentLocalNow } from './now';

// Same pattern as format.test.ts: save/restore process.env.TZ so these tests
// can't leak a changed host timezone into a later test file.
const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

describe('currentLocalNow', () => {
  it('renders a UTC instant as the Jerusalem wall clock', () => {
    // 2026-08-29T09:00Z is 12:00 in Jerusalem (IDT, UTC+3).
    expect(currentLocalNow(new Date('2026-08-29T09:00:00Z'))).toBe('2026-08-29T12:00');
  });

  it('always produces the exact shape format.ts parses', () => {
    expect(currentLocalNow(new Date('2026-01-05T04:07:00Z'))).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
  });

  it('resolves the Jerusalem calendar day, not the UTC one', () => {
    // 22:30Z on the 29th is 01:30 on the 30th in Jerusalem. A naive
    // implementation reports the 29th and the eyebrow date is a day behind.
    expect(currentLocalNow(new Date('2026-08-29T22:30:00Z'))).toBe('2026-08-30T01:30');
  });

  it('pads single-digit months, days, hours and minutes', () => {
    expect(currentLocalNow(new Date('2026-03-02T05:04:00Z'))).toBe('2026-03-02T07:04');
  });

  it('pins the timezone to a single documented constant', () => {
    expect(APP_TIMEZONE).toBe('Asia/Jerusalem');
  });

  it('yields the same result under TZ=America/Los_Angeles', () => {
    // Proves currentLocalNow is independent of the host machine's zone, not
    // merely of UTC. Without the explicit `timeZone: APP_TIMEZONE` pin in
    // now.ts, this would resolve to the host zone and fail here — the earlier
    // 5 tests above all keep passing under a deleted pin as long as the test
    // runner's own TZ happens to be UTC, which is why this needs its own case.
    process.env.TZ = 'America/Los_Angeles';
    expect(currentLocalNow(new Date('2026-08-29T09:00:00Z'))).toBe('2026-08-29T12:00');
  });

  it('yields the same result under TZ=Asia/Jerusalem', () => {
    // Jerusalem is also APP_TIMEZONE, so this is the case most likely to pass
    // by accident even with the pin removed (host TZ == target TZ). Kept
    // anyway because it's the zone this repo's own dev machine runs in.
    process.env.TZ = 'Asia/Jerusalem';
    expect(currentLocalNow(new Date('2026-08-29T09:00:00Z'))).toBe('2026-08-29T12:00');
  });
});
