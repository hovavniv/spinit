import { describe, expect, it } from 'vitest';
import { seedSongs, sortByVotes, toggleExpanded } from './heroDemo';

describe('sortByVotes', () => {
  it('returns songs in descending vote-count order', () => {
    const sorted = sortByVotes(seedSongs);
    const votes = sorted.map((song) => song.votes);
    const expected = [...votes].sort((a, b) => b - a);
    expect(votes).toEqual(expected);
  });

  it('moves a song that gains a vote ahead of the one it overtakes', () => {
    // "Levitating" (12 votes) is behind "September" (19 votes) in the seed order.
    const levitating = seedSongs.find((song) => song.title === 'Levitating')!;
    const september = seedSongs.find((song) => song.title === 'September')!;

    const before = sortByVotes(seedSongs);
    expect(before.indexOf(september)).toBeLessThan(before.indexOf(levitating));

    const bumped = seedSongs.map((song) =>
      song.id === levitating.id ? { ...song, votes: song.votes + 8 } : song
    );
    const after = sortByVotes(bumped);
    const newLevitating = after.find((song) => song.id === levitating.id)!;
    const newSeptember = after.find((song) => song.id === september.id)!;
    expect(after.indexOf(newLevitating)).toBeLessThan(after.indexOf(newSeptember));
  });
});

describe('toggleExpanded', () => {
  it('returns the id when current is a different id', () => {
    expect(toggleExpanded(1, 2)).toBe(2);
  });

  it('returns the id when current is null', () => {
    expect(toggleExpanded(null, 3)).toBe(3);
  });

  it('returns null when current equals id (collapses an open row)', () => {
    expect(toggleExpanded(3, 3)).toBeNull();
  });
});
