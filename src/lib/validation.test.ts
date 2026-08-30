import { describe, expect, it, test } from 'vitest';
import {
  formDataToRecord,
  loginSchema,
  PHONE_PATTERN,
  profileSchema,
  registerSchema,
  mustPlayAddSchema,
  blocklistAddSchema,
  rowRefSchema,
  eventDetailsSchema,
} from './validation';

function toFormData(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

describe('formDataToRecord', () => {
  it('coerces a missing field to an empty string', () => {
    const formData = new FormData();
    formData.set('email', 'foo@bar.com');
    // password intentionally absent
    const record = formDataToRecord(formData);
    expect(record.password).toBeUndefined();
    expect(record.email).toBe('foo@bar.com');
  });

  it('coerces a File-valued entry to an empty string', () => {
    const formData = new FormData();
    formData.set('email', new File(['x'], 'x.txt'));
    const record = formDataToRecord(formData);
    expect(record.email).toBe('');
  });
});

describe('loginSchema', () => {
  const validValues = { email: 'foo@bar.com', password: 'password123' };

  it('errors when email is empty', () => {
    const result = loginSchema.safeParse({ ...validValues, email: '' });
    expect(result.success).toBe(false);
  });

  it('errors when email is malformed', () => {
    const result = loginSchema.safeParse({ ...validValues, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('errors when password is empty', () => {
    const result = loginSchema.safeParse({ ...validValues, password: '' });
    expect(result.success).toBe(false);
  });

  it('passes for valid login values', () => {
    const result = loginSchema.safeParse(validValues);
    expect(result.success).toBe(true);
  });

  it('does not throw on a missing FormData field, and produces a validation error', () => {
    const formData = new FormData();
    formData.set('email', 'foo@bar.com');
    // password field never appended at all
    expect(() => loginSchema.safeParse(formDataToRecord(formData))).not.toThrow();
    const result = loginSchema.safeParse(formDataToRecord(formData));
    expect(result.success).toBe(false);
  });

  it('does not throw on a File-valued FormData field, and produces a validation error', () => {
    const formData = toFormData(validValues);
    formData.set('email', new File(['x'], 'x.txt'));
    expect(() => loginSchema.safeParse(formDataToRecord(formData))).not.toThrow();
    const result = loginSchema.safeParse(formDataToRecord(formData));
    expect(result.success).toBe(false);
  });

  it('errors when password exceeds 72 bytes, pinning bytes not characters', () => {
    // '💩' is a 4-byte UTF-8 character. 19 repeats = 76 bytes, well over 72,
    // but only 19 UTF-16 code points, well under a naive 72-character cap.
    const password = '\u{1F4A9}'.repeat(19);
    const result = loginSchema.safeParse({ ...validValues, password });
    expect(result.success).toBe(false);
  });

  it('passes at exactly 72 bytes with multi-byte characters', () => {
    // 18 repeats of a 4-byte character = 72 bytes exactly.
    const password = '\u{1F4A9}'.repeat(18);
    const result = loginSchema.safeParse({ ...validValues, password });
    expect(result.success).toBe(true);
  });
});

describe('registerSchema', () => {
  const validValues = {
    name: 'Jane DJ',
    businessName: 'Jane Spins LLC',
    email: 'foo@bar.com',
    confirmEmail: 'foo@bar.com',
    phone: '5551234567',
    password: 'password123',
    confirmPassword: 'password123',
  };

  it('errors when name is empty', () => {
    const result = registerSchema.safeParse({ ...validValues, name: '' });
    expect(result.success).toBe(false);
  });

  it('errors when name exceeds 100 characters', () => {
    const result = registerSchema.safeParse({ ...validValues, name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('passes when name is exactly 100 characters', () => {
    const result = registerSchema.safeParse({ ...validValues, name: 'a'.repeat(100) });
    expect(result.success).toBe(true);
  });

  it('errors when DJ business name is empty', () => {
    const result = registerSchema.safeParse({ ...validValues, businessName: '' });
    expect(result.success).toBe(false);
  });

  it('errors when business name exceeds 100 characters', () => {
    const result = registerSchema.safeParse({ ...validValues, businessName: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('errors when email is malformed', () => {
    const result = registerSchema.safeParse({
      ...validValues,
      email: 'not-an-email',
      confirmEmail: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('errors when email exceeds 254 characters', () => {
    const longEmail = `${'a'.repeat(250)}@b.co`; // > 254 chars total
    const result = registerSchema.safeParse({
      ...validValues,
      email: longEmail,
      confirmEmail: longEmail,
    });
    expect(result.success).toBe(false);
  });

  it('passes when confirm email differs only in case', () => {
    const result = registerSchema.safeParse({
      ...validValues,
      email: 'Foo@Bar.com',
      confirmEmail: 'foo@bar.com',
    });
    expect(result.success).toBe(true);
  });

  it('errors when confirm email is genuinely different', () => {
    const result = registerSchema.safeParse({
      ...validValues,
      email: 'foo@bar.com',
      confirmEmail: 'other@bar.com',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const confirmEmailIssue = result.error.issues.find((issue) =>
        issue.path.includes('confirmEmail'),
      );
      expect(confirmEmailIssue).toBeTruthy();
    }
  });

  it('errors when phone is empty', () => {
    const result = registerSchema.safeParse({ ...validValues, phone: '' });
    expect(result.success).toBe(false);
  });

  it('errors when phone exceeds 20 characters', () => {
    const result = registerSchema.safeParse({ ...validValues, phone: '1'.repeat(21) });
    expect(result.success).toBe(false);
  });

  it('errors when phone does not match the allowed format', () => {
    const result = registerSchema.safeParse({ ...validValues, phone: 'call me maybe' });
    expect(result.success).toBe(false);
  });

  it('errors when password is exactly 7 characters', () => {
    const result = registerSchema.safeParse({
      ...validValues,
      password: '1234567',
      confirmPassword: '1234567',
    });
    expect(result.success).toBe(false);
  });

  it('passes the length rule when password is exactly 8 characters', () => {
    const result = registerSchema.safeParse({
      ...validValues,
      password: '12345678',
      confirmPassword: '12345678',
    });
    expect(result.success).toBe(true);
  });

  it('errors when password exceeds 72 bytes, pinning bytes not characters', () => {
    // '💩' is a 4-byte UTF-8 character. 19 repeats = 76 bytes, well over 72,
    // but only 19 UTF-16 code points, well under a naive 72-character cap.
    const password = '\u{1F4A9}'.repeat(19);
    const result = registerSchema.safeParse({
      ...validValues,
      password,
      confirmPassword: password,
    });
    expect(result.success).toBe(false);
  });

  it('passes at exactly 72 bytes with multi-byte characters', () => {
    // 18 repeats of a 4-byte character = 72 bytes exactly.
    const password = '\u{1F4A9}'.repeat(18);
    const result = registerSchema.safeParse({
      ...validValues,
      password,
      confirmPassword: password,
    });
    expect(result.success).toBe(true);
  });

  it('errors when confirm password does not match', () => {
    const result = registerSchema.safeParse({
      ...validValues,
      password: 'password123',
      confirmPassword: 'password124',
    });
    expect(result.success).toBe(false);
  });

  it('passes for fully valid register values', () => {
    const result = registerSchema.safeParse(validValues);
    expect(result.success).toBe(true);
  });

  it('tolerates and strips an extra dialCode key rather than rejecting it', () => {
    const result = registerSchema.safeParse({ ...validValues, dialCode: '+1' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('dialCode');
    }
  });

  it('does not throw on a missing FormData field, and produces a validation error', () => {
    const formData = toFormData(validValues);
    formData.delete('phone');
    expect(() => registerSchema.safeParse(formDataToRecord(formData))).not.toThrow();
    const result = registerSchema.safeParse(formDataToRecord(formData));
    expect(result.success).toBe(false);
  });

  it('does not throw on a File-valued FormData field, and produces a validation error', () => {
    const formData = toFormData(validValues);
    formData.set('phone', new File(['x'], 'x.txt'));
    expect(() => registerSchema.safeParse(formDataToRecord(formData))).not.toThrow();
    const result = registerSchema.safeParse(formDataToRecord(formData));
    expect(result.success).toBe(false);
  });
});

describe('profileSchema', () => {
  it('passes for a valid business name and phone', () => {
    const result = profileSchema.safeParse({
      businessName: 'Jane Spins LLC',
      phone: '5551234567',
    });
    expect(result.success).toBe(true);
  });

  it('errors when business name exceeds 100 characters', () => {
    const result = profileSchema.safeParse({
      businessName: 'a'.repeat(101),
      phone: '5551234567',
    });
    expect(result.success).toBe(false);
  });

  it('errors when phone does not match the allowed format', () => {
    const result = profileSchema.safeParse({
      businessName: 'Jane Spins LLC',
      phone: 'not a phone',
    });
    expect(result.success).toBe(false);
  });
});

describe('PHONE_PATTERN', () => {
  it('matches a joined dial-code + local-number value', () => {
    expect(PHONE_PATTERN.test('+1(555) 123-4567')).toBe(true);
  });

  it('rejects the joined value when the dial code carries a baked-in flag emoji', () => {
    // Regression case: RegisterForm.tsx's dial-code option VALUES currently
    // bake in the flag emoji (e.g. '🇺🇸 +1', near line 17), so today's real
    // joined submission value looks like this and must fail the format
    // check. Fixing the <select> itself is a later task; this test only pins
    // that the regex correctly rejects the current buggy joined value.
    expect(PHONE_PATTERN.test('🇺🇸 +1(555) 123-4567')).toBe(false);
  });
});

const A_UUID = '11111111-2222-4333-8444-555555555555';

describe('mustPlayAddSchema', () => {
  test('trims before checking length, so spaces are an empty title', () => {
    const result = mustPlayAddSchema.safeParse({
      eventId: A_UUID,
      segment: 'reception',
      title: '   ',
      artist: '',
      moment: '',
    });

    expect(result.success).toBe(false);
  });

  test('accepts a title alone and trims it', () => {
    const result = mustPlayAddSchema.safeParse({
      eventId: A_UUID,
      segment: 'party',
      title: '  September  ',
      artist: '',
      moment: '',
    });

    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('September');
  });

  test('rejects ceremony — that segment is written only by its slots', () => {
    const result = mustPlayAddSchema.safeParse({
      eventId: A_UUID,
      segment: 'ceremony',
      title: 'Hava Nagila',
      artist: '',
      moment: '',
    });

    expect(result.success).toBe(false);
  });

  test('rejects a title of 201 characters', () => {
    const result = mustPlayAddSchema.safeParse({
      eventId: A_UUID,
      segment: 'party',
      title: 'x'.repeat(201),
      artist: '',
      moment: '',
    });

    expect(result.success).toBe(false);
  });

  test('rejects an eventId that is not a uuid', () => {
    const result = mustPlayAddSchema.safeParse({
      eventId: 'priya-alex',
      segment: 'party',
      title: 'September',
      artist: '',
      moment: '',
    });

    expect(result.success).toBe(false);
  });
});

describe('blocklistAddSchema', () => {
  test('accepts the three entry types and nothing else', () => {
    for (const entryType of ['artist', 'song', 'genre']) {
      expect(
        blocklistAddSchema.safeParse({
          eventId: A_UUID,
          segment: 'party',
          entryType,
          value: 'Nickelback',
        }).success,
      ).toBe(true);
    }

    expect(
      blocklistAddSchema.safeParse({
        eventId: A_UUID,
        segment: 'party',
        entryType: 'album',
        value: 'Nickelback',
      }).success,
    ).toBe(false);
  });

  test('rejects an empty value', () => {
    const result = blocklistAddSchema.safeParse({
      eventId: A_UUID,
      segment: 'party',
      entryType: 'artist',
      value: '  ',
    });

    expect(result.success).toBe(false);
  });
});

describe('rowRefSchema', () => {
  test('needs both a row id and an event id, both uuids', () => {
    expect(rowRefSchema.safeParse({ id: A_UUID, eventId: A_UUID }).success).toBe(true);
    expect(rowRefSchema.safeParse({ id: A_UUID, eventId: '' }).success).toBe(false);
    expect(rowRefSchema.safeParse({ id: 'nope', eventId: A_UUID }).success).toBe(false);
  });
});

describe('eventDetailsSchema', () => {
  test('turns empty notes into null rather than an empty string', () => {
    // An event nobody has written notes for has NO notes, which is not the
    // same fact as an empty string (design §5.1).
    const result = eventDetailsSchema.safeParse({ eventId: A_UUID, notes: '   ' });

    expect(result.success).toBe(true);
    expect(result.data?.notes).toBeNull();
  });

  test('rejects notes over 2000 characters', () => {
    const result = eventDetailsSchema.safeParse({ eventId: A_UUID, notes: 'x'.repeat(2001) });

    expect(result.success).toBe(false);
  });
});
