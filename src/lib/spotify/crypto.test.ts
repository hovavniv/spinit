import { beforeEach, describe, expect, it } from 'vitest';
import { encryptToken, decryptToken } from './crypto';

beforeEach(() => {
  process.env.SPOTIFY_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('token encryption', () => {
  it('round-trips', () => {
    expect(decryptToken(encryptToken('AQD-refresh-token'))).toBe('AQD-refresh-token');
  });

  it('produces a different ciphertext each time, because the IV is fresh', () => {
    expect(encryptToken('same')).not.toBe(encryptToken('same'));
  });

  it('emits the v1 envelope with four dot-separated parts', () => {
    const parts = encryptToken('x').split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('FAILS CLOSED on a corrupted auth tag rather than returning garbage', () => {
    const [v, iv, tag, ct] = encryptToken('secret').split('.');
    const flipped = Buffer.from(tag, 'base64url');
    flipped[0] ^= 0xff;
    expect(() => decryptToken([v, iv, flipped.toString('base64url'), ct].join('.')))
      .toThrow();
  });

  it('rejects an envelope with an unknown version', () => {
    const [, iv, tag, ct] = encryptToken('x').split('.');
    expect(() => decryptToken(['v2', iv, tag, ct].join('.'))).toThrow(/version/i);
  });

  it('throws a NAMED error when the key is missing, not a crypto error', () => {
    delete process.env.SPOTIFY_TOKEN_KEY;
    expect(() => encryptToken('x')).toThrow(/SPOTIFY_TOKEN_KEY/);
  });

  it('rejects a key that is not 32 bytes', () => {
    process.env.SPOTIFY_TOKEN_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptToken('x')).toThrow(/32/);
  });
});
