import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/* ---------------------------------------------------------------------------
   Refresh tokens are encrypted in the APPLICATION before they reach Postgres
   (design §7.3), so a database dump alone does not yield usable credentials.

   Format:  v1.<base64url iv>.<base64url authTag>.<base64url ciphertext>

   The version prefix exists so the key can be rotated: a v2 reader can accept
   both. Without it, rotation means a migration.
   --------------------------------------------------------------------------- */

const VERSION = 'v1';
const IV_BYTES = 12;          // GCM's standard nonce length

function key(): Buffer {
  const raw = process.env.SPOTIFY_TOKEN_KEY;
  if (!raw) throw new Error('SPOTIFY_TOKEN_KEY is not set');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`SPOTIFY_TOKEN_KEY must decode to 32 bytes, got ${buf.length}`);
  }
  return buf;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ct.toString('base64url'),
  ].join('.');
}

export function decryptToken(envelope: string): string {
  const [version, iv, tag, ct] = envelope.split('.');
  if (version !== VERSION) throw new Error(`unknown token envelope version: ${version}`);
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  // .final() THROWS on a tag mismatch. That is the fail-closed behaviour and it
  // is why nothing here catches.
  return Buffer.concat([
    decipher.update(Buffer.from(ct, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
