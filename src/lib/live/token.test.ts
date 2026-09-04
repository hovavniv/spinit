import { describe, expect, it } from 'vitest';
import { randomToken, TOKEN_PATTERN } from './token';

describe('randomToken', () => {
  it('matches the database CHECK constraint, 1000 times running', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(randomToken()).toMatch(TOKEN_PATTERN);
    }
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomToken()));
    expect(seen.size).toBe(500);
  });
});
