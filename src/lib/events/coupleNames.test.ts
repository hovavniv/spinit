import { describe, test, expect } from 'vitest';

import { composeCoupleNames } from './coupleNames';

describe('composeCoupleNames', () => {
  test('joins the two names with an ampersand', () => {
    expect(composeCoupleNames('Alex', 'Sam')).toBe('Alex & Sam');
  });

  test('trims each name before joining', () => {
    expect(composeCoupleNames('  Alex  ', ' Sam ')).toBe('Alex & Sam');
  });

  test('leaves an ampersand inside a name alone', () => {
    // This is exactly why nothing in this codebase splits the result back
    // apart: the composed string is ambiguous, so the two names are stored
    // in their own columns instead (design §3.3).
    expect(composeCoupleNames('Ben & Jerry', 'Dana')).toBe('Ben & Jerry & Dana');
  });
});
