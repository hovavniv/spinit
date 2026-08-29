/* ---------------------------------------------------------------------------
   Tests for src/lib/dashboard/format.ts (design/specs/2026-08-29-dj-dashboard-design.md §6, §10).
   Written before format.ts exists, per the plan's Task 4 (test-first).
   --------------------------------------------------------------------------- */

import { describe, it, expect, afterEach } from 'vitest';
import {
  greeting,
  formatEyebrowDate,
  daysUntil,
  initials,
  formatCardDate,
  formatPastDate,
  formatStartTime,
  firstName,
} from './format';

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

describe('greeting', () => {
  it('is "Good morning" at hour 0 (start of the morning band)', () => {
    expect(greeting('2026-08-27T00:00')).toBe('Good morning');
  });

  it('is "Good morning" at hour 11 (still morning, the boundary)', () => {
    expect(greeting('2026-08-27T11:30')).toBe('Good morning');
  });

  it('is "Good afternoon" at hour 12 (afternoon starts)', () => {
    expect(greeting('2026-08-27T12:00')).toBe('Good afternoon');
  });

  it('is "Good afternoon" at hour 17 (still afternoon, the boundary)', () => {
    expect(greeting('2026-08-27T17:45')).toBe('Good afternoon');
  });

  it('is "Good evening" at hour 18 (evening starts)', () => {
    expect(greeting('2026-08-27T18:00')).toBe('Good evening');
  });

  it('is "Good evening" at hour 23 (end of the evening band)', () => {
    expect(greeting('2026-08-27T23:59')).toBe('Good evening');
  });
});

describe('formatEyebrowDate', () => {
  it('formats 2026-08-27T20:00 as "Thursday, August 27" (not the artboard\'s wrong "Tuesday")', () => {
    expect(formatEyebrowDate('2026-08-27T20:00')).toBe('Thursday, August 27');
  });

  it('yields the same result under TZ=America/Los_Angeles', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatEyebrowDate('2026-08-27T20:00')).toBe('Thursday, August 27');
  });

  it('yields the same result under TZ=Asia/Jerusalem', () => {
    process.env.TZ = 'Asia/Jerusalem';
    expect(formatEyebrowDate('2026-08-27T20:00')).toBe('Thursday, August 27');
  });
});

describe('daysUntil', () => {
  it('returns "today" when the event date is the same calendar day as now', () => {
    expect(daysUntil('2026-08-27', '2026-08-27T20:00')).toBe('today');
  });

  it('returns "tomorrow" when the event is the next calendar day, even before an hour boundary', () => {
    expect(daysUntil('2026-08-28', '2026-08-27T20:00')).toBe('tomorrow');
  });

  it('returns "in 16 days" for the design doc\'s own fixture (Sep 12 from Aug 27)', () => {
    expect(daysUntil('2026-09-12', '2026-08-27T20:00')).toBe('in 16 days');
  });

  it('returns "in 37 days" for the design doc\'s own fixture (Oct 3 from Aug 27)', () => {
    expect(daysUntil('2026-10-03', '2026-08-27T20:00')).toBe('in 37 days');
  });

  it('returns null (not "today") for a date already in the past', () => {
    expect(daysUntil('2026-08-26', '2026-08-27T20:00')).toBeNull();
  });

  it('returns the same "in 16 days" result under TZ=America/Los_Angeles', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(daysUntil('2026-09-12', '2026-08-27T20:00')).toBe('in 16 days');
  });

  it('returns the same "in 16 days" result under TZ=Asia/Jerusalem', () => {
    process.env.TZ = 'Asia/Jerusalem';
    expect(daysUntil('2026-09-12', '2026-08-27T20:00')).toBe('in 16 days');
  });
});

describe('initials', () => {
  it('takes the first letter of the first and last token for a two-word name', () => {
    expect(initials('Jordan Ellis')).toBe('JE');
  });

  it('yields a single letter for a one-word name', () => {
    expect(initials('Jordan')).toBe('J');
  });

  it('drops a middle initial, using only the first and last token for a three-word name', () => {
    expect(initials('Jordan A. Ellis')).toBe('JE');
  });
});

describe('formatCardDate', () => {
  it('formats 2026-09-12 as "Sep 12, 2026" (abbreviated month, no leading zero)', () => {
    expect(formatCardDate('2026-09-12')).toBe('Sep 12, 2026');
  });

  it('yields the same result under TZ=America/Los_Angeles', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatCardDate('2026-09-12')).toBe('Sep 12, 2026');
  });

  it('yields the same result under TZ=Asia/Jerusalem', () => {
    process.env.TZ = 'Asia/Jerusalem';
    expect(formatCardDate('2026-09-12')).toBe('Sep 12, 2026');
  });
});

describe('formatPastDate', () => {
  it('formats 2026-07-18 as "July 18, 2026" (full month name, distinct from formatCardDate)', () => {
    expect(formatPastDate('2026-07-18')).toBe('July 18, 2026');
  });

  it('yields the same result under TZ=America/Los_Angeles', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatPastDate('2026-07-18')).toBe('July 18, 2026');
  });

  it('yields the same result under TZ=Asia/Jerusalem', () => {
    process.env.TZ = 'Asia/Jerusalem';
    expect(formatPastDate('2026-07-18')).toBe('July 18, 2026');
  });
});

describe('formatStartTime', () => {
  it('formats 2026-08-27T20:00:00-07:00 as "8:00 PM" (12-hour, no leading zero)', () => {
    expect(formatStartTime('2026-08-27T20:00:00-07:00')).toBe('8:00 PM');
  });

  it('formats midnight (00:00) as "12:00 AM"', () => {
    expect(formatStartTime('2026-08-27T00:00:00-07:00')).toBe('12:00 AM');
  });

  it('formats noon (12:00) as "12:00 PM"', () => {
    expect(formatStartTime('2026-08-27T12:00:00-07:00')).toBe('12:00 PM');
  });
});

describe('firstName', () => {
  it('returns the first whitespace-separated token', () => {
    expect(firstName('Jordan Ellis')).toBe('Jordan');
  });
});
