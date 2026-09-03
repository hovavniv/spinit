import { z } from 'zod';

/**
 * Mirrors the SQL `phone_fmt` check constraint (design 5.1):
 * `phone ~ '^\+?[0-9 ()-]{7,20}$'`. Exported so the server action that joins
 * the dial code and local number together (design 4.1 step 4, plan task 7)
 * can validate that joined string against the exact same shape used here and
 * enforced by the database.
 */
export const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;

/**
 * A `FormData` field is typed `FormDataEntryValue | null` (`string | File |
 * null`), not `string`. Zod's schemas below expect a plain object of
 * strings, so every entry is coerced through here first: a `File` part or a
 * missing field both become `''`, which then fails the schema's own
 * `min(1)`/format checks as an ordinary validation error rather than
 * throwing a `TypeError` out of the caller (design 7.1).
 */
export function formDataToRecord(formData: FormData): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    record[key] = typeof value === 'string' ? value : '';
  }
  return record;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

const emailField = z
  .string()
  .min(1, 'Email is required.')
  .max(254, 'Enter a valid email address.')
  .pipe(z.email('Enter a valid email address.'));

const nameField = z
  .string()
  .min(1, 'Name is required.')
  .max(100, 'Name must be at most 100 characters.');

const businessNameField = z
  .string()
  .min(1, 'DJ business name is required.')
  .max(100, 'DJ business name must be at most 100 characters.');

const phoneField = z
  .string()
  .min(1, 'Phone number is required.')
  .max(20, 'Phone number must be at most 20 characters.')
  .refine((value) => PHONE_PATTERN.test(value), 'Enter a valid phone number.');

const registerPasswordField = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .refine((value) => byteLength(value) <= 72, 'Password must be at most 72 characters.');

export const loginSchema = z.object({
  email: emailField,
  password: z
    .string()
    .min(1, 'Password is required.')
    .refine((value) => byteLength(value) <= 72, 'Password must be at most 72 characters.'),
});

export const registerSchema = z
  .object({
    name: nameField,
    businessName: businessNameField,
    email: emailField,
    confirmEmail: z.string().min(1, 'Confirm your email.'),
    phone: phoneField,
    password: registerPasswordField,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .superRefine((values, ctx) => {
    if (
      values.email &&
      values.confirmEmail &&
      values.confirmEmail.trim().toLowerCase() !== values.email.trim().toLowerCase()
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmEmail'],
        message: 'Emails do not match.',
      });
    }

    if (values.password && values.confirmPassword && values.confirmPassword !== values.password) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match.',
      });
    }
  });

export const profileSchema = z.object({
  businessName: businessNameField,
  phone: phoneField,
});

/**
 * Is this string a UUID? Used to reject a path segment BEFORE it reaches
 * Postgres: `select ... where id = 'banana'` raises 22P02, which surfaces as
 * a 500, and a bad URL should be a 404 (design §4.1).
 *
 * `z.uuid()` is zod 4's top-level form; `z.string().uuid()` is the v3 spelling
 * and this repo is on 4.5.2. It is STRICTER than Postgres's `uuid` type — it
 * enforces the RFC 4122 version and variant nibbles, so it rejects a handful
 * of strings (the nil UUID among them) that Postgres would accept and simply
 * return no rows for. Harmless here: every id this app can hold comes from
 * `gen_random_uuid()` or the seed's `derivedId`, which stamps version 5 and
 * the variant explicitly. `z.guid()` is the permissive alternative if that
 * ever stops being true.
 */
export function isUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

/* ---------------------------------------------------------------------------
   The event page (docs/specs/2026-08-30-event-detail-design.md §8.1).

   Every rule below mirrors a database constraint from §5.1, so a bad input is
   refused before it reaches Postgres -- and refused again by the check
   constraint if it somehow does. `.trim()` runs before `.min()`, so a field of
   spaces is empty rather than valid.
   --------------------------------------------------------------------------- */

const eventIdField = z.uuid('That event link is not valid.');

/**
 * Ceremony is absent on purpose. Its rows are written only by the ceremony
 * slots, which resolve their `moment` from CEREMONY_SLOTS -- so the add-row
 * form cannot be pointed at the ceremony segment.
 */
const addableSegmentField = z.enum(['reception', 'party'], {
  message: 'Unknown part of the evening.',
});

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === '' ? null : value));

/**
 * Every song and artist entry is PICKED from Spotify, never typed (design
 * §2.2, §5.2): a participant holds table-level insert/update grants on both
 * tables and can PATCH PostgREST directly, so this is a real control, not
 * only a UX nicety — it mirrors the database's own shape constraints.
 */
const spotifyIdShape = /^[A-Za-z0-9]{22}$/;

const requiredSpotifyId = (message: string) => z.string().trim().regex(spotifyIdShape, message);

/**
 * An optional Spotify id: absent, or present and shaped like one. A bare
 * `.optional()` only excuses `undefined` — `formDataToRecord` turns a missing
 * `FormData` field into nothing at all (not `''`), so both "field never sent"
 * and "field sent empty" must be legal here, but a present-and-malformed
 * value must still fail.
 */
const optionalSpotifyId = (message: string) =>
  z
    .string()
    .trim()
    .optional()
    .refine((value) => value === undefined || value === '' || spotifyIdShape.test(value), message);

export const mustPlayAddSchema = z.object({
  eventId: eventIdField,
  segment: addableSegmentField,
  title: z
    .string()
    .trim()
    .min(1, 'A song title is required.')
    .max(200, 'Song title must be at most 200 characters.'),
  artist: optionalText(200, 'Artist must be at most 200 characters.'),
  moment: optionalText(100, 'Moment must be at most 100 characters.'),
  spotifyTrackId: requiredSpotifyId('Pick a song from the search results.'),
  spotifyArtistId: optionalSpotifyId('Pick an artist from the search results.'),
});

export const blocklistAddSchema = z
  .object({
    eventId: eventIdField,
    segment: addableSegmentField,
    entryType: z.enum(['artist', 'song', 'genre'], { message: 'Choose artist, song or genre.' }),
    value: z
      .string()
      .trim()
      .min(1, 'Enter an artist, song or genre.')
      .max(100, 'Must be at most 100 characters.'),
    spotifyId: z.string().trim().optional(),
  })
  /**
   * Mirrors the database's `blocklist_id_matches_type` check constraint
   * (plan task 13): a genre has no Spotify identity, an artist or song is
   * picked and always has one. Zod gives the user a field error; the
   * constraint is the actual control, same reasoning as `spotifyIdShape`.
   */
  .superRefine((values, ctx) => {
    const id = values.spotifyId ?? '';
    if (values.entryType === 'genre') {
      if (id !== '') {
        ctx.addIssue({ code: 'custom', path: ['spotifyId'], message: 'A genre has no Spotify id.' });
      }
      return;
    }
    if (!spotifyIdShape.test(id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['spotifyId'],
        message: 'Pick a result from the search list.',
      });
    }
  });

/** A remove: which row, and which event's page to revalidate. */
export const rowRefSchema = z.object({
  id: z.uuid('That row is not valid.'),
  eventId: eventIdField,
});

export const eventDetailsSchema = z.object({
  eventId: eventIdField,
});

/**
 * The two note bodies (design §3, §5.2). Notes left `events` for two tables
 * with two different policies -- private is the DJ's alone, shared is everyone
 * on the event -- so they are validated apart from the event's own details.
 *
 * 2000 is the check constraint's number, said again here so the user sees a
 * field error rather than a generic failure from Postgres. The body is NOT
 * `optionalText`: '' is the column default and a real value meaning "cleared",
 * not the absence of a note, and the write is an upsert either way.
 */
const notesBody = z.string().max(2000, 'Keep notes under 2000 characters.');

export const privateNotesSchema = z.object({
  eventId: eventIdField,
  body: notesBody,
});

export const sharedNotesSchema = privateNotesSchema;

/**
 * One ceremony slot. A BLANK TITLE IS LEGAL and means "clear this slot"
 * (design §8.1): both slots are empty on a fresh event, and the save bar
 * submits them together with the notes, so treating an empty title as a
 * validation error would mean a DJ who typed only notes loses the notes.
 */
export const ceremonySlotSchema = z
  .object({
    id: z.union([z.uuid(), z.literal('')]),
    title: z.string().trim().max(200, 'Song title must be at most 200 characters.'),
    artist: optionalText(200, 'Artist must be at most 200 characters.'),
    spotifyTrackId: optionalSpotifyId('Pick a song from the search results.'),
    spotifyArtistId: optionalSpotifyId('Pick an artist from the search results.'),
  })
  /**
   * The track id is required only once the title is — a blank title still
   * means "clear this slot" (see the comment above), and clearing needs no
   * id. A non-blank title is a pick, and a pick always carries an id.
   */
  .superRefine((values, ctx) => {
    if (values.title !== '' && !values.spotifyTrackId) {
      ctx.addIssue({
        code: 'custom',
        path: ['spotifyTrackId'],
        message: 'Pick a song from the search results.',
      });
    }
  });

/* ---------------------------------------------------------------------------
   Spotify search proxy (plan task 6). Backs the track/artist pickers.
   --------------------------------------------------------------------------- */

export const spotifySearchSchema = z.object({
  q: z.string().trim().min(2, 'Type at least two characters.').max(100),
  type: z.enum(['track', 'artist']),
});

/* ---------------------------------------------------------------------------
   The New Event wizard (docs/specs/2026-09-02-new-event-design.md §7).

   Every bound below repeats a database check constraint's own number, so the
   DJ sees a field error rather than a generic failure from Postgres.
   --------------------------------------------------------------------------- */

const partnerNameField = z
  .string()
  .trim()
  .min(1, 'Both names are required.')
  .max(120, 'A name must be at most 120 characters.');

/**
 * A real calendar day, not a YYYY-MM-DD shape.
 *
 * `2026-02-31` passes a regex and raises Postgres 22008, which would surface
 * as the generic "Could not save that." A browser's <input type="date">
 * prevents it, but a server action is a public HTTP endpoint reachable
 * without ever loading the page (design §5.4 applies the same reasoning to
 * authorization).
 *
 * Date.UTC round-trips the parts: JavaScript's Date rolls 2026-02-31 forward
 * to 2026-03-03 rather than rejecting it, so the only reliable check is that
 * the parts survive the trip unchanged.
 */
const eventDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, 'That date does not exist.');

/**
 * Optional, and '' means absent rather than invalid: the field is optional on
 * the artboard, and a DJ who leaves it blank must not get an error.
 * `guest_count_range` in 20260903090000_event_wizard_columns.sql is the source
 * of 1 and 10000.
 */
const guestCountField = z
  .union([
    z.literal(''),
    z.coerce
      .number()
      .int('Guest count must be a whole number.')
      .min(1, 'Guest count must be at least 1.')
      .max(10000, 'Guest count must be at most 10000.'),
  ])
  .transform((value) => (value === '' ? null : value));

export const eventDraftSchema = z
  .object({
    /** '' on /events/new (insert), a uuid on /events/new/[id] (update). */
    eventId: z.union([z.uuid(), z.literal('')]),
    partner1Name: partnerNameField,
    partner2Name: partnerNameField,
    eventDate: eventDateField,
    venue: z.string().trim().min(1, 'Venue is required.').max(120, 'Venue must be at most 120 characters.'),
    guestCount: guestCountField,
  })
  .refine(
    (values) => `${values.partner1Name} & ${values.partner2Name}`.length <= 120,
    {
      // Capping each name at 58 would satisfy couple_names_len with a number
      // that means nothing to a DJ. The real constraint is on the composed
      // value, so that is what is reported (design §3.3).
      message: 'Those two names are too long together — keep them under 120 characters combined.',
      path: ['partner2Name'],
    },
  );

/**
 * Step 2. Emails only: step 1 already collected both names and stores them, so
 * display_name is filled from partner1_name/partner2_name rather than asking
 * twice. The artboard has no name fields here either (design §4.2).
 *
 * `emailField` (max 254) rather than partner_email_len's 3–320: every other
 * email in this app is capped at 254, and an address the invite form accepts
 * while the register form rejects it is a live inconsistency for a couple who
 * has to do both (design §7).
 */
export const partnerInviteSchema = z.object({
  eventId: eventIdField,
  email1: emailField,
  email2: emailField,
});
