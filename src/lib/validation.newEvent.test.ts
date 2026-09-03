import { describe, test, expect } from 'vitest';

import { eventDraftSchema, partnerInviteSchema } from './validation';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

const validDraft = {
  eventId: '',
  partner1Name: 'Alex',
  partner2Name: 'Sam',
  eventDate: '2026-10-04',
  venue: 'Brookline Barn',
  guestCount: '120',
};

describe('eventDraftSchema', () => {
  test('accepts a complete draft', () => {
    expect(eventDraftSchema.safeParse(validDraft).success).toBe(true);
  });

  test('accepts a blank guest count as absent', () => {
    const parsed = eventDraftSchema.safeParse({ ...validDraft, guestCount: '' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.guestCount).toBeNull();
  });

  test.each([
    ['zero', '0'],
    ['above the ceiling', '10001'],
    ['fractional', '1.5'],
  ])('rejects a guest count that is %s', (_label, guestCount) => {
    expect(eventDraftSchema.safeParse({ ...validDraft, guestCount }).success).toBe(false);
  });

  test('rejects two names that are individually legal but too long together', () => {
    // 60 + 3 + 60 = 123, over couple_names_len's 120. Each name alone is fine,
    // which is exactly why the check is on the composed value (design §3.3).
    const long = 'x'.repeat(60);
    const parsed = eventDraftSchema.safeParse({
      ...validDraft,
      partner1Name: long,
      partner2Name: long,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/too long together/);
    }
  });

  test('rejects a date that is well-formed but not a real day', () => {
    // 2026-02-31 satisfies YYYY-MM-DD and raises Postgres 22008. A server
    // action is a public endpoint, so the shape check is not enough.
    expect(eventDraftSchema.safeParse({ ...validDraft, eventDate: '2026-02-31' }).success).toBe(
      false,
    );
  });

  test('rejects a date that is not YYYY-MM-DD at all', () => {
    expect(eventDraftSchema.safeParse({ ...validDraft, eventDate: '04/10/2026' }).success).toBe(
      false,
    );
  });
});

describe('partnerInviteSchema', () => {
  const validInvite = {
    eventId: EVENT_ID,
    email1: 'alex@example.org',
    email2: 'sam@example.org',
  };

  test('accepts two valid addresses', () => {
    expect(partnerInviteSchema.safeParse(validInvite).success).toBe(true);
  });

  test('rejects an invalid address', () => {
    expect(partnerInviteSchema.safeParse({ ...validInvite, email2: 'nope' }).success).toBe(false);
  });

  test('rejects a non-uuid event id', () => {
    expect(partnerInviteSchema.safeParse({ ...validInvite, eventId: 'banana' }).success).toBe(
      false,
    );
  });
});
