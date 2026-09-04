import { randomInt } from 'node:crypto';

/**
 * The shape the `join_token_shape` CHECK enforces in the database. Exported so
 * the test asserts against the same pattern the constraint uses -- an earlier
 * design generated base64url (which contains `-` and `_`) against this exact
 * regex, so roughly half of all tokens would have been rejected by Postgres and
 * `startEvent` would have failed at random in production.
 */
export const TOKEN_PATTERN = /^[A-Za-z0-9]{22}$/;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * 22 characters drawn from a 62-character alphabet: about 2^131.
 *
 * `randomInt(62)` is rejection-sampled inside Node and therefore uniform.
 * `randomBytes(n) % 62` is NOT: 256 = 4x62 + 8, so residues 0-7 occur five
 * times per byte and 8-61 occur four, biasing the low end of the alphabet.
 */
export function randomToken(): string {
  let out = '';
  for (let i = 0; i < 22; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
