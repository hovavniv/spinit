import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `readMostRequestedPlayed`'s own logic: counting votes, ignoring songs
 * nobody requested, and breaking ties deterministically. Its own file rather
 * than an addition to `liveDal.test.ts`, because that file's `from` double is
 * shaped for `readLiveState`'s four reads and this needs a different pair.
 */
const playedRows: unknown[] = [];
const suggestionRows: unknown[] = [];

const from = vi.fn((table: string) => {
  if (table === 'played_songs') {
    return {
      select: () => ({ eq: () => ({ order: async () => ({ data: playedRows, error: null }) }) }),
    };
  }
  return { select: () => ({ eq: async () => ({ data: suggestionRows, error: null }) }) };
});

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ from })) }));

import { readMostRequestedPlayed } from './liveDal';

const EVENT = '33333333-3333-4333-8333-333333333333';

function played(position: number, title: string, trackId: string | null) {
  return { position, title, spotify_track_id: trackId };
}
function suggestion(trackId: string, voteCount: number) {
  return {
    id: `s-${trackId}`,
    spotify_track_id: trackId,
    suggestion_votes: Array.from({ length: voteCount }, (_, i) => ({ guest_id: `g${i}` })),
  };
}

beforeEach(() => {
  playedRows.length = 0;
  suggestionRows.length = 0;
});

describe('readMostRequestedPlayed', () => {
  it('returns the played song with the most distinct requesters', async () => {
    playedRows.push(played(1, 'Never Gonna Give You Up', 'aaaaaaaaaaaaaaaaaaaaaa'));
    playedRows.push(played(2, 'September', 'bbbbbbbbbbbbbbbbbbbbbb'));
    suggestionRows.push(suggestion('aaaaaaaaaaaaaaaaaaaaaa', 2));
    suggestionRows.push(suggestion('bbbbbbbbbbbbbbbbbbbbbb', 5));

    expect(await readMostRequestedPlayed(EVENT)).toBe('September');
  });

  // A DJ pick and a ceremony cue have no suggestion behind them. They must not
  // win with a count of zero just by being in the playlist.
  it('ignores played songs that nobody requested', async () => {
    playedRows.push(played(1, 'Hava Nagila', 'cccccccccccccccccccccc'));
    playedRows.push(played(2, 'kiss me', 'dddddddddddddddddddddd'));
    suggestionRows.push(suggestion('dddddddddddddddddddddd', 1));

    expect(await readMostRequestedPlayed(EVENT)).toBe('kiss me');
  });

  // Deterministic, not "whichever row came back first" -- `played` is ordered
  // by position and the comparison is strict `>`.
  it('breaks a tie by the earlier position', async () => {
    playedRows.push(played(1, 'First', 'eeeeeeeeeeeeeeeeeeeeee'));
    playedRows.push(played(2, 'Second', 'ffffffffffffffffffffff'));
    suggestionRows.push(suggestion('eeeeeeeeeeeeeeeeeeeeee', 3));
    suggestionRows.push(suggestion('ffffffffffffffffffffff', 3));

    expect(await readMostRequestedPlayed(EVENT)).toBe('First');
  });

  // A partner's read is filtered to zero rows by RLS, not errored. Null means
  // "nothing to show", and the page turns it into a reason rather than a blank.
  it('returns null when no suggestions are readable', async () => {
    playedRows.push(played(1, 'September', 'bbbbbbbbbbbbbbbbbbbbbb'));
    expect(await readMostRequestedPlayed(EVENT)).toBeNull();
  });

  it('returns null when nothing was played', async () => {
    expect(await readMostRequestedPlayed(EVENT)).toBeNull();
  });
});
