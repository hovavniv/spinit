import { describe, expect, it } from 'vitest';
import type { BlocklistRow, MustPlayRow } from '@/lib/events/detailTypes';
import type { PlayedTrack, QueueSuggestion, RankInput } from './liveTypes';
import { rankQueue } from './rank';

/** Minimal valid suggestion; each test overrides only what it varies. */
function makeSuggestion(overrides: Partial<QueueSuggestion> = {}): QueueSuggestion {
  return {
    id: 'sugg-1',
    spotifyTrackId: 'track-1',
    title: 'Some Song',
    artist: 'Some Artist',
    artistIds: ['artist-1'],
    requesters: 1,
    createdAt: '2026-09-05T10:00:00.000Z',
    suggestedByName: 'Guest',
    ...overrides,
  };
}

function makeInput(overrides: Partial<RankInput> = {}): RankInput {
  return {
    suggestions: [],
    mustPlay: [],
    blocklist: [],
    genresByArtistId: {},
    played: [],
    phase: 'open-floor',
    minutesLeftInPhase: null,
    ...overrides,
  };
}

function makeMustPlay(overrides: Partial<MustPlayRow> = {}): MustPlayRow {
  return {
    id: 'mp-1',
    segment: 'party',
    title: 'Must Play',
    artist: 'Someone',
    moment: null,
    spotify_track_id: 'track-mustplay',
    spotify_artist_id: 'artist-mustplay',
    created_at: '2026-09-05T09:00:00.000Z',
    ...overrides,
  };
}

function makeBlocklist(overrides: Partial<BlocklistRow> = {}): BlocklistRow {
  return {
    id: 'bl-1',
    segment: 'party',
    entry_type: 'song',
    value: 'Blocked Song',
    spotify_id: 'track-blocked',
    created_at: '2026-09-05T09:00:00.000Z',
    ...overrides,
  };
}

function makePlayed(overrides: Partial<PlayedTrack> = {}): PlayedTrack {
  return {
    position: 1,
    spotifyTrackId: 'played-track-1',
    artistIds: [],
    ...overrides,
  };
}

describe('rankQueue', () => {
  it('removes a song that has already been played', () => {
    const suggestion = makeSuggestion({ id: 's1', spotifyTrackId: 'track-played' });
    const input = makeInput({
      suggestions: [suggestion],
      played: [makePlayed({ spotifyTrackId: 'track-played' })],
    });

    const result = rankQueue(input);

    expect(result.queue.map((r) => r.suggestion.id)).not.toContain('s1');
    expect(result.blocked.map((r) => r.suggestion.id)).not.toContain('s1');
  });

  it('moves a blocklisted song out of the queue with a blocked-song reason', () => {
    const suggestion = makeSuggestion({ id: 's1', spotifyTrackId: 'track-blocked' });
    const input = makeInput({
      suggestions: [suggestion],
      phase: 'open-floor',
      blocklist: [
        makeBlocklist({
          entry_type: 'song',
          spotify_id: 'track-blocked',
          segment: 'party', // open-floor -> party
        }),
      ],
    });

    const result = rankQueue(input);

    expect(result.queue.map((r) => r.suggestion.id)).not.toContain('s1');
    const blockedRow = result.blocked.find((r) => r.suggestion.id === 's1');
    expect(blockedRow).toBeDefined();
    expect(blockedRow?.blocked).toEqual({ kind: 'blocked-song', title: 'Some Song' });
  });

  it('blocks a song whose FEATURED artist is on the blocklist', () => {
    const suggestion = makeSuggestion({
      id: 's1',
      artist: 'Robin Thicke',
      artistIds: ['artist-main', 'artist-featured'],
    });
    const input = makeInput({
      suggestions: [suggestion],
      phase: 'open-floor',
      blocklist: [
        makeBlocklist({
          entry_type: 'artist',
          spotify_id: 'artist-featured',
          segment: 'party',
        }),
      ],
    });

    const result = rankQueue(input);

    expect(result.queue.map((r) => r.suggestion.id)).not.toContain('s1');
    const blockedRow = result.blocked.find((r) => r.suggestion.id === 's1');
    expect(blockedRow?.blocked).toEqual({ kind: 'blocked-artist', artist: 'Robin Thicke' });
  });

  it('blocks a song whose artist genre is on the blocklist', () => {
    const suggestion = makeSuggestion({
      id: 's1',
      artistIds: ['artist-1'],
    });
    const input = makeInput({
      suggestions: [suggestion],
      phase: 'open-floor',
      genresByArtistId: { 'artist-1': { metal: 5 } },
      blocklist: [
        makeBlocklist({
          entry_type: 'genre',
          value: 'metal',
          spotify_id: null,
          segment: 'party',
        }),
      ],
    });

    const result = rankQueue(input);

    expect(result.queue.map((r) => r.suggestion.id)).not.toContain('s1');
    const blockedRow = result.blocked.find((r) => r.suggestion.id === 's1');
    expect(blockedRow?.blocked).toEqual({ kind: 'blocked-genre', genre: 'metal' });
  });

  it("only applies blocklist rows for the CURRENT phase's segment", () => {
    const suggestion = makeSuggestion({
      id: 's1',
      artistIds: ['artist-1'],
    });
    const input = makeInput({
      suggestions: [suggestion],
      phase: 'open-floor', // maps to 'party'
      blocklist: [
        makeBlocklist({
          entry_type: 'artist',
          spotify_id: 'artist-1',
          segment: 'reception', // does NOT match 'party'
        }),
      ],
    });

    const result = rankQueue(input);

    expect(result.queue.map((r) => r.suggestion.id)).toContain('s1');
    expect(result.blocked.map((r) => r.suggestion.id)).not.toContain('s1');
  });

  it('ranks by distinct requesters', () => {
    // Lower requesters gets the earlier createdAt, so the tiebreaker alone
    // would put it first -- only term 3 (requesters) can put the higher one first.
    const low = makeSuggestion({
      id: 'low',
      spotifyTrackId: 'track-low',
      requesters: 4,
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const high = makeSuggestion({
      id: 'high',
      spotifyTrackId: 'track-high',
      requesters: 5,
      createdAt: '2026-09-05T10:05:00.000Z',
    });
    const input = makeInput({ suggestions: [low, high] });

    const result = rankQueue(input);

    expect(result.queue.map((r) => r.suggestion.id)).toEqual(['high', 'low']);
  });

  it('floats an unplayed must-play above a more-requested song', () => {
    const mustPlaySong = makeSuggestion({
      id: 'must',
      spotifyTrackId: 'track-mustplay',
      requesters: 1,
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const rival = makeSuggestion({
      id: 'rival',
      spotifyTrackId: 'track-rival',
      requesters: 20,
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const input = makeInput({
      suggestions: [mustPlaySong, rival],
      phase: 'open-floor',
      mustPlay: [makeMustPlay({ spotify_track_id: 'track-mustplay', segment: 'party' })],
    });

    const result = rankQueue(input);

    expect(result.queue.map((r) => r.suggestion.id)).toEqual(['must', 'rival']);
    const mustRow = result.queue.find((r) => r.suggestion.id === 'must');
    expect(mustRow?.reasons).toContainEqual({ kind: 'must-play-unplayed' });
  });

  it('penalises an artist played two songs ago', () => {
    const penalized = makeSuggestion({
      id: 'penalized',
      spotifyTrackId: 'track-penalized',
      artistIds: ['artist-repeat'],
      requesters: 5,
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const rival = makeSuggestion({
      id: 'rival',
      spotifyTrackId: 'track-rival',
      artistIds: ['artist-other'],
      requesters: 5,
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const input = makeInput({
      suggestions: [penalized, rival],
      played: [
        makePlayed({ position: 1, spotifyTrackId: 'p1', artistIds: ['artist-x'] }),
        makePlayed({ position: 2, spotifyTrackId: 'p2', artistIds: ['artist-repeat'] }),
      ],
    });

    const result = rankQueue(input);

    expect(result.queue.map((r) => r.suggestion.id)).toEqual(['rival', 'penalized']);
    const penalizedRow = result.queue.find((r) => r.suggestion.id === 'penalized');
    expect(penalizedRow?.reasons).toContainEqual({
      kind: 'artist-repeat',
      artist: 'Some Artist',
      songsAgo: 1,
    });
  });

  it('boosts a must-play when the phase is nearly over', () => {
    const mustPlaySong = makeSuggestion({
      id: 'must',
      spotifyTrackId: 'track-mustplay',
      requesters: 1,
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const rival = makeSuggestion({
      id: 'rival',
      spotifyTrackId: 'track-rival',
      requesters: 30, // 1 + 25 + 10 = 36 > 30; without the +10, 26 < 30
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const input = makeInput({
      suggestions: [mustPlaySong, rival],
      phase: 'open-floor',
      minutesLeftInPhase: 10,
      mustPlay: [makeMustPlay({ spotify_track_id: 'track-mustplay', segment: 'party' })],
    });

    const result = rankQueue(input);

    expect(result.queue.map((r) => r.suggestion.id)).toEqual(['must', 'rival']);
    const mustRow = result.queue.find((r) => r.suggestion.id === 'must');
    expect(mustRow?.reasons).toContainEqual({
      kind: 'phase-ending',
      phase: 'open-floor',
      minutesLeft: 10,
    });
  });

  it('does not fire the time terms when the phase clock is null', () => {
    const mustPlaySong = makeSuggestion({
      id: 'must',
      spotifyTrackId: 'track-mustplay',
      requesters: 1,
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const input = makeInput({
      suggestions: [mustPlaySong],
      phase: 'open-floor',
      minutesLeftInPhase: null,
      mustPlay: [makeMustPlay({ spotify_track_id: 'track-mustplay', segment: 'party' })],
    });

    const result = rankQueue(input);

    const mustRow = result.queue.find((r) => r.suggestion.id === 'must');
    expect(mustRow?.reasons.some((r) => r.kind === 'phase-ending')).toBe(false);
  });

  // Term 6 (phase fit) has no dedicated test in the brief's list of 12 --
  // flagged in the report. Added here so the term 6 mutation proof is
  // meaningful rather than vacuous.
  it('boosts a song whose genre fits the current phase over a plain rival', () => {
    const fitting = makeSuggestion({
      id: 'fitting',
      spotifyTrackId: 'track-fitting',
      artistIds: ['artist-pop'],
      requesters: 5,
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const rival = makeSuggestion({
      id: 'rival',
      spotifyTrackId: 'track-rival',
      artistIds: ['artist-none'],
      requesters: 6, // without the +8, 6 > 5 and rival wins; with it, 13 > 6
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    const input = makeInput({
      suggestions: [fitting, rival],
      phase: 'open-floor',
      genresByArtistId: { 'artist-pop': { pop: 5 } },
    });

    const result = rankQueue(input);

    expect(result.queue.map((r) => r.suggestion.id)).toEqual(['fitting', 'rival']);
    const fittingRow = result.queue.find((r) => r.suggestion.id === 'fitting');
    expect(fittingRow?.reasons).toContainEqual({
      kind: 'phase-fit',
      phase: 'open-floor',
      fits: true,
    });
  });

  it('emits genre-pending for a track with no resolved artists', () => {
    const suggestion = makeSuggestion({ id: 's1', artistIds: [] });
    const input = makeInput({ suggestions: [suggestion] });

    const result = rankQueue(input);

    const row = result.queue.find((r) => r.suggestion.id === 's1');
    expect(row?.reasons).toContainEqual({ kind: 'genre-pending' });
  });

  // Widened 2026-09-05 (Task 12a): a track with a RESOLVED artist that has
  // not been genre-enriched yet must look the same to the DJ as an
  // unresolved one -- both mean "the do-not-play genre check has not run".
  // Without this, a song could pass the genre check purely because
  // enrichment hasn't caught up, with no signal it was never actually
  // checked -- the same failure shape as a blocked song silently vanishing.
  it('emits genre-pending when the artist is resolved but has no genre entry yet', () => {
    const suggestion = makeSuggestion({ id: 's1', artistIds: ['artist-1'] });
    // A DIFFERENT artist has genre data; 'artist-1' has none at all -- not
    // even an empty {} entry, which would mean "checked, no genres found"
    // rather than "not checked yet".
    const input = makeInput({
      suggestions: [suggestion],
      genresByArtistId: { 'artist-other': { pop: 100 } },
    });

    const result = rankQueue(input);

    const row = result.queue.find((r) => r.suggestion.id === 's1');
    expect(row?.reasons).toContainEqual({ kind: 'genre-pending' });
  });

  it('does NOT emit genre-pending when the artist is resolved with genuinely zero genres', () => {
    const suggestion = makeSuggestion({ id: 's1', artistIds: ['artist-1'] });
    // An EMPTY entry (not a missing one) means the check ran and found
    // nothing -- a real, valid outcome distinct from "not yet checked".
    const input = makeInput({
      suggestions: [suggestion],
      genresByArtistId: { 'artist-1': {} },
    });

    const result = rankQueue(input);

    const row = result.queue.find((r) => r.suggestion.id === 's1');
    expect(row?.reasons).not.toContainEqual({ kind: 'genre-pending' });
  });

  it('is invariant under input permutation', () => {
    const suggestions = ['a', 'b', 'c', 'd'].map((id) =>
      makeSuggestion({
        id,
        spotifyTrackId: `track-${id}`,
        requesters: 3,
        createdAt: '2026-09-05T10:00:00.000Z', // byte-identical across all
      }),
    );
    const input = makeInput({ suggestions });
    const shuffledInput = makeInput({ suggestions: [...suggestions].reverse() });

    const result = rankQueue(input);
    const shuffledResult = rankQueue(shuffledInput);

    expect(shuffledResult.queue.map((r) => r.suggestion.id)).toEqual(
      result.queue.map((r) => r.suggestion.id),
    );
    expect(result.queue.map((r) => r.suggestion.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
