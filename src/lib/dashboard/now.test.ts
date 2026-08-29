import { describe, expect, it } from 'vitest';
import { APP_TIMEZONE, currentLocalNow } from './now';

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
});
