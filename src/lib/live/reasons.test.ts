import { describe, expect, it } from 'vitest';
import { renderReasons } from './reasons';

describe('renderReasons', () => {
  it('renders a single reason as a sentence', () => {
    expect(renderReasons([{ kind: 'requesters', count: 19 }]))
      .toBe('19 people asked for it.');
  });

  it('joins two reasons with "and"', () => {
    expect(renderReasons([
      { kind: 'requesters', count: 19 },
      { kind: 'must-play-unplayed' },
    ])).toBe("19 people asked for it, and it's still an unplayed must-play.");
  });

  // The comma-and-clause assembly is where "19 votes, , and open-floor" lives.
  it('joins three reasons with commas and a final "and"', () => {
    const out = renderReasons([
      { kind: 'requesters', count: 12 },
      { kind: 'must-play-unplayed' },
      { kind: 'artist-repeat', artist: 'Bruno Mars', songsAgo: 2 },
    ]);
    expect(out).not.toContain(', ,');
    expect(out).toContain('and');
    expect(out.endsWith('.')).toBe(true);
  });

  it('caps at three reasons so a row never grows into a paragraph', () => {
    const out = renderReasons([
      { kind: 'requesters', count: 5 },
      { kind: 'must-play-unplayed' },
      { kind: 'artist-repeat', artist: 'ABBA', songsAgo: 1 },
      { kind: 'phase-fit', phase: 'open-floor', fits: true },
    ]);
    expect(out).not.toContain('open-floor');
  });

  it('returns an empty string for no reasons rather than a stray full stop', () => {
    expect(renderReasons([])).toBe('');
  });
});
