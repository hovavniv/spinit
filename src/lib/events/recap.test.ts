import { describe, test, expect } from 'vitest';
import { songTag, mostActiveGuest } from './recap';
import type { PlayedSong } from './types';

const song = (over: Partial<PlayedSong> = {}): PlayedSong => ({
  position: 1,
  title: 'September',
  artist: 'Earth, Wind & Fire',
  suggested_by: null,
  ...over,
});

describe('songTag', () => {
  test('names the guest who suggested it', () => {
    expect(songTag(song({ suggested_by: 'Dana R.' }))).toBe('requested by Dana R.');
  });

  test('a null suggested_by is the DJ own pick', () => {
    expect(songTag(song({ suggested_by: null }))).toBe('DJ pick');
  });

  // The column's check constraint permits '', so this is reachable data,
  // not a hypothetical.
  test('an empty suggested_by is a DJ pick, not a dangling "requested by"', () => {
    expect(songTag(song({ suggested_by: '' }))).toBe('DJ pick');
  });

  test('a whitespace-only suggested_by is a DJ pick', () => {
    expect(songTag(song({ suggested_by: '   ' }))).toBe('DJ pick');
  });

  test('trims a name before rendering it', () => {
    expect(songTag(song({ suggested_by: '  Omer  ' }))).toBe('requested by Omer');
  });
});

describe('mostActiveGuest', () => {
  test('returns the most frequent suggester', () => {
    expect(
      mostActiveGuest([
        song({ position: 1, suggested_by: 'Dana R.' }),
        song({ position: 2, suggested_by: 'Yuval' }),
        song({ position: 3, suggested_by: 'Dana R.' }),
      ]),
    ).toBe('Dana R.');
  });

  // Deterministic by construction, not by luck — see the `>` in the
  // implementation.
  test('a tie is broken by earliest appearance in playlist order', () => {
    expect(
      mostActiveGuest([
        song({ position: 1, suggested_by: 'Yuval' }),
        song({ position: 2, suggested_by: 'Dana R.' }),
      ]),
    ).toBe('Yuval');
  });

  test('counts a trimmed name and its untrimmed twin as one guest', () => {
    expect(
      mostActiveGuest([
        song({ position: 1, suggested_by: 'Omer' }),
        song({ position: 2, suggested_by: 'Noa' }),
        song({ position: 3, suggested_by: ' Omer ' }),
      ]),
    ).toBe('Omer');
  });

  test('returns null when every song is a DJ pick', () => {
    expect(mostActiveGuest([song({ position: 1 }), song({ position: 2 })])).toBeNull();
  });

  test('returns null for an empty playlist', () => {
    expect(mostActiveGuest([])).toBeNull();
  });

  // The bug this guards: counting absent entries would make "nobody" the
  // most active guest at almost every event.
  test('one named guest beats many absent ones', () => {
    expect(
      mostActiveGuest([
        song({ position: 1, suggested_by: null }),
        song({ position: 2, suggested_by: '' }),
        song({ position: 3, suggested_by: '   ' }),
        song({ position: 4, suggested_by: 'Tamar K.' }),
      ]),
    ).toBe('Tamar K.');
  });
});
