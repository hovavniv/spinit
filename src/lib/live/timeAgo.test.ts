import { describe, expect, it } from 'vitest';
import { timeAgo } from './timeAgo';

const NOW = new Date('2026-09-06T12:00:00.000Z');

function secondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

describe('timeAgo', () => {
  it('reads "just now" at 0 seconds elapsed', () => {
    expect(timeAgo(secondsAgo(0), NOW)).toBe('just now');
  });

  it('reads "just now" at 59 seconds elapsed', () => {
    expect(timeAgo(secondsAgo(59), NOW)).toBe('just now');
  });

  it('rounds down: 119 seconds elapsed reads "1m ago", not "2m ago"', () => {
    expect(timeAgo(secondsAgo(119), NOW)).toBe('1m ago');
  });

  it('reads "1m ago" at exactly 60 seconds elapsed', () => {
    expect(timeAgo(secondsAgo(60), NOW)).toBe('1m ago');
  });

  it('reads "59m ago" at 59 minutes elapsed', () => {
    expect(timeAgo(secondsAgo(59 * 60), NOW)).toBe('59m ago');
  });

  it('reads "1h ago" at exactly 60 minutes elapsed', () => {
    expect(timeAgo(secondsAgo(60 * 60), NOW)).toBe('1h ago');
  });

  it('reads "2h ago" at 2 hours elapsed', () => {
    expect(timeAgo(secondsAgo(2 * 60 * 60), NOW)).toBe('2h ago');
  });
});
