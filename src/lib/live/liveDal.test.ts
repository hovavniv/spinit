import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ---------------------------------------------------------------------------
   WHY THIS FILE EXISTS (design §8.1, §8.2).

   readLiveState assembles four reads that must stay correctly ORDERED
   (event_must_play, event_blocklist, song_suggestions all rely on a
   created_at+id tiebreaker -- Postgres `now()` is transaction-start time, so a
   seed script's multi-row insert can hand back byte-identical created_at
   values and PostgREST is then free to return the tie in either order) and
   must NOT lean on a PostgREST aggregate embed for the vote tally (this
   project has never enabled db-aggregates-enabled). The assertions below are
   about the actual `.order(...)` calls and the actual separate `.from(...)`
   calls, not just the shape of the final return value -- a test that only
   checked the return value could stay green after either bug was
   reintroduced.
   --------------------------------------------------------------------------- */

const EVENT = '11111111-1111-4111-8111-111111111111';

// ---- events chain: .select().eq().order()x5.maybeSingle() ----
const eventsOrderCalls: [string, unknown][] = [];
const eventsMaybeSingle = vi.fn();
const eventsOrder = vi.fn((col: string, opts: unknown) => {
  eventsOrderCalls.push([col, opts]);
  return eventsChain;
});
const eventsEq = vi.fn(() => eventsChain);
const eventsSelect = vi.fn(() => eventsChain);
const eventsChain = {
  select: eventsSelect,
  eq: eventsEq,
  order: eventsOrder,
  maybeSingle: eventsMaybeSingle,
};

// ---- song_suggestions chain: .select().eq().eq().order().order() ----
const suggestionsOrderCalls: [string, unknown][] = [];
const suggestionsResult = vi.fn();
const suggestionsOrder2 = vi.fn((col: string, opts: unknown) => {
  suggestionsOrderCalls.push([col, opts]);
  return suggestionsResult();
});
const suggestionsOrder1 = vi.fn((col: string, opts: unknown) => {
  suggestionsOrderCalls.push([col, opts]);
  return { order: suggestionsOrder2 };
});
const suggestionsEqCalls: [string, unknown][] = [];
const suggestionsEq2 = vi.fn((col: string, val: unknown) => {
  suggestionsEqCalls.push([col, val]);
  return { order: suggestionsOrder1 };
});
const suggestionsEq1 = vi.fn((col: string, val: unknown) => {
  suggestionsEqCalls.push([col, val]);
  return { eq: suggestionsEq2 };
});
const suggestionsSelect = vi.fn((cols: string) => {
  suggestionsSelectArg.value = cols;
  return { eq: suggestionsEq1 };
});
const suggestionsSelectArg = { value: '' };

// ---- suggestion_votes chain: .select().in() ----
const votesSelect = vi.fn((cols: string) => {
  votesSelectArg.value = cols;
  return { in: votesIn };
});
const votesSelectArg = { value: '' };
const votesIn = vi.fn();

// ---- spotify_track_artists chain: .select().in().order().order() ----
const artistsOrderCalls: [string, unknown][] = [];
const artistsResult = vi.fn();
const artistsOrder2 = vi.fn((col: string, opts: unknown) => {
  artistsOrderCalls.push([col, opts]);
  return artistsResult();
});
const artistsOrder1 = vi.fn((col: string, opts: unknown) => {
  artistsOrderCalls.push([col, opts]);
  return { order: artistsOrder2 };
});
const artistsIn = vi.fn(() => ({ order: artistsOrder1 }));
const artistsSelect = vi.fn(() => ({ in: artistsIn }));

// ---- spotify_tracks chain: .select().in(), resolves directly ----
const tracksResult = vi.fn();
const tracksIn = vi.fn(() => tracksResult());
const tracksSelect = vi.fn(() => ({ in: tracksIn }));

const from = vi.fn((table: string) => {
  if (table === 'events') return eventsChain;
  if (table === 'song_suggestions') return { select: suggestionsSelect };
  if (table === 'suggestion_votes') return { select: votesSelect };
  if (table === 'spotify_track_artists') return { select: artistsSelect };
  if (table === 'spotify_tracks') return { select: tracksSelect };
  throw new Error(`liveDal.test.ts: unexpected table "${table}"`);
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from })),
}));

vi.mock('@/lib/genres/genresDal', () => ({
  readGenresForEvent: vi.fn(async () => ({})),
}));

import { createClient } from '@/lib/supabase/server';
import { readGenresForEvent } from '@/lib/genres/genresDal';
import { readLiveState } from './liveDal';

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT,
    phase: 'dinner',
    phase_started_at: '2026-09-04T18:00:00.000Z',
    event_must_play: [],
    event_blocklist: [],
    played_songs: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  eventsOrderCalls.length = 0;
  suggestionsOrderCalls.length = 0;
  suggestionsEqCalls.length = 0;
  artistsOrderCalls.length = 0;
  eventsMaybeSingle.mockResolvedValue({ data: eventRow(), error: null });
  suggestionsResult.mockResolvedValue({ data: [], error: null });
  votesIn.mockResolvedValue({ data: [], error: null });
  artistsResult.mockResolvedValue({ data: [], error: null });
  tracksResult.mockResolvedValue({ data: [], error: null });
  (readGenresForEvent as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from });
});

describe('readLiveState', () => {
  it('orders event_must_play, event_blocklist and played_songs with the created_at+id tiebreaker', async () => {
    // Postgres now() is transaction-start time -- a seed script's multi-row
    // insert can hand every row in one statement a byte-identical created_at,
    // and PostgREST returns a tie in whichever order the executor picks
    // unless a unique tiebreaker column is also named. This is a REAL bug
    // that shipped once in detailDal.ts; that history is exactly why this is
    // asserted directly rather than trusted by inspection.
    await readLiveState(EVENT);

    expect(eventsOrderCalls).toContainEqual([
      'created_at',
      { referencedTable: 'event_must_play', ascending: true },
    ]);
    expect(eventsOrderCalls).toContainEqual([
      'id',
      { referencedTable: 'event_must_play', ascending: true },
    ]);
    expect(eventsOrderCalls).toContainEqual([
      'created_at',
      { referencedTable: 'event_blocklist', ascending: true },
    ]);
    expect(eventsOrderCalls).toContainEqual([
      'id',
      { referencedTable: 'event_blocklist', ascending: true },
    ]);
    expect(eventsOrderCalls).toContainEqual([
      'position',
      { referencedTable: 'played_songs', ascending: true },
    ]);
    // played_songs never ties -- (event_id, position) is unique -- so it gets
    // no id tiebreaker; this asserts that no extra tiebreaker order call was
    // added for it.
    expect(eventsOrderCalls.filter(([, opts]) => (opts as { referencedTable?: string }).referencedTable === 'played_songs')).toHaveLength(1);
  });

  it('orders pending song_suggestions with the same created_at+id tiebreaker', async () => {
    await readLiveState(EVENT);

    expect(suggestionsOrderCalls).toContainEqual(['created_at', { ascending: true }]);
    expect(suggestionsOrderCalls).toContainEqual(['id', { ascending: true }]);
  });

  it('filters song_suggestions to this event and status pending', async () => {
    await readLiveState(EVENT);

    expect(suggestionsEqCalls).toContainEqual(['event_id', EVENT]);
    expect(suggestionsEqCalls).toContainEqual(['status', 'pending']);
  });

  it('queries suggestion_votes as a bare suggestion_id select, never an aggregate embed', async () => {
    // PostgREST disables aggregate functions (db-aggregates-enabled) by
    // default and this project has never turned it on. A `suggestion_votes
    // (count)` embed is either an error or silently empty depending on
    // PostgREST version -- either way, the wrong tool. The tally must be
    // computed in TypeScript from bare rows.
    suggestionsResult.mockResolvedValue({
      data: [{ id: 's1', spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', title: 'A', artist: 'B', created_at: '2026-01-01', guest_sessions: { display_name: 'Noa' } }],
      error: null,
    });

    await readLiveState(EVENT);

    expect(votesSelectArg.value).toBe('suggestion_id');
    expect(votesSelectArg.value).not.toMatch(/count/);
  });

  it('tallies votes per suggestion in TypeScript, including a zero-vote suggestion', async () => {
    suggestionsResult.mockResolvedValue({
      data: [
        { id: 's-heavy', spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', title: 'Heavy', artist: 'A', created_at: '2026-01-01T00:00:00Z', guest_sessions: { display_name: 'Noa' } },
        { id: 's-zero', spotify_track_id: 'bbbbbbbbbbbbbbbbbbbbbb', title: 'Zero', artist: 'B', created_at: '2026-01-01T00:00:01Z', guest_sessions: { display_name: 'Eitan' } },
      ],
      error: null,
    });
    votesIn.mockResolvedValue({
      data: [
        { suggestion_id: 's-heavy' },
        { suggestion_id: 's-heavy' },
        { suggestion_id: 's-heavy' },
      ],
      error: null,
    });

    const state = await readLiveState(EVENT);

    const heavy = state.suggestions.find((s) => s.id === 's-heavy');
    const zero = state.suggestions.find((s) => s.id === 's-zero');
    expect(heavy?.requesters).toBe(3);
    expect(zero?.requesters).toBe(0);
  });

  it('reads spotify_track_artists as its own separate query, not embedded in events or song_suggestions', async () => {
    suggestionsResult.mockResolvedValue({
      data: [{ id: 's1', spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', title: 'A', artist: 'B', created_at: '2026-01-01', guest_sessions: { display_name: 'Noa' } }],
      error: null,
    });

    await readLiveState(EVENT);

    expect(from).toHaveBeenCalledWith('spotify_track_artists');
    // Neither embedded select string mentions it -- there is no FK for
    // PostgREST to traverse (the id columns are bare text matching by value).
    expect(suggestionsSelectArg.value).not.toMatch(/spotify_track_artists/);
  });

  it('orders spotify_track_artists by track id then ordinal', async () => {
    suggestionsResult.mockResolvedValue({
      data: [{ id: 's1', spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', title: 'A', artist: 'B', created_at: '2026-01-01', guest_sessions: { display_name: 'Noa' } }],
      error: null,
    });

    await readLiveState(EVENT);

    expect(artistsOrderCalls).toContainEqual(['spotify_track_id', { ascending: true }]);
    expect(artistsOrderCalls).toContainEqual(['ordinal', { ascending: true }]);
  });

  it('resolves artistIds for a suggestion from spotify_track_artists', async () => {
    suggestionsResult.mockResolvedValue({
      data: [{ id: 's1', spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', title: 'A', artist: 'B', created_at: '2026-01-01', guest_sessions: { display_name: 'Noa' } }],
      error: null,
    });
    artistsResult.mockResolvedValue({
      data: [
        { spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', spotify_artist_id: 'artist-1', artist_name: 'Artist One' },
        { spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', spotify_artist_id: 'artist-2', artist_name: 'Artist Two' },
      ],
      error: null,
    });

    const state = await readLiveState(EVENT);

    expect(state.suggestions[0].artistIds).toEqual(['artist-1', 'artist-2']);
  });

  it('resolves the DISPLAY title/artist from spotify_tracks, separate from the guest\'s own text', async () => {
    suggestionsResult.mockResolvedValue({
      data: [{ id: 's1', spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', title: 'guest typed this', artist: 'guest artist', created_at: '2026-01-01', guest_sessions: { display_name: 'Noa' } }],
      error: null,
    });
    tracksResult.mockResolvedValue({
      data: [{ spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', title: 'September', artist: 'Earth, Wind & Fire' }],
      error: null,
    });

    const state = await readLiveState(EVENT);

    expect(state.suggestions[0].title).toBe('guest typed this');
    expect(state.suggestions[0].resolvedTitle).toBe('September');
    expect(state.suggestions[0].resolvedArtist).toBe('Earth, Wind & Fire');
  });

  it('leaves resolvedTitle/resolvedArtist null for a track with no spotify_tracks row', async () => {
    suggestionsResult.mockResolvedValue({
      data: [{ id: 's1', spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', title: 'A', artist: 'B', created_at: '2026-01-01', guest_sessions: { display_name: 'Noa' } }],
      error: null,
    });
    tracksResult.mockResolvedValue({ data: [], error: null });

    const state = await readLiveState(EVENT);

    expect(state.suggestions[0].resolvedTitle).toBeNull();
    expect(state.suggestions[0].resolvedArtist).toBeNull();
  });

  it('skips the spotify_tracks query when there are no distinct track ids', async () => {
    suggestionsResult.mockResolvedValue({ data: [], error: null });

    await readLiveState(EVENT);

    expect(tracksSelect).not.toHaveBeenCalled();
  });

  it('gives a suggestion whose track has no spotify_track_artists rows an empty artistIds', async () => {
    suggestionsResult.mockResolvedValue({
      data: [{ id: 's1', spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', title: 'A', artist: 'B', created_at: '2026-01-01', guest_sessions: { display_name: 'Noa' } }],
      error: null,
    });
    artistsResult.mockResolvedValue({ data: [], error: null });

    const state = await readLiveState(EVENT);

    expect(state.suggestions[0].artistIds).toEqual([]);
  });

  it('resolves artistIds for a played track from the same spotify_track_artists read, and [] for a null track id', async () => {
    eventsMaybeSingle.mockResolvedValue({
      data: eventRow({
        played_songs: [
          { position: 1, spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa' },
          { position: 2, spotify_track_id: null },
        ],
      }),
      error: null,
    });
    artistsResult.mockResolvedValue({
      data: [{ spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa', spotify_artist_id: 'artist-1', artist_name: 'Artist One' }],
      error: null,
    });

    const state = await readLiveState(EVENT);

    expect(state.played).toEqual([
      { position: 1, spotifyTrackId: 'aaaaaaaaaaaaaaaaaaaaaa', artistIds: ['artist-1'] },
      { position: 2, spotifyTrackId: null, artistIds: [] },
    ]);
  });

  it('calls readGenresForEvent once with this event id and passes its result through unchanged', async () => {
    const genres = { 'artist-1': { pop: 80 } };
    (readGenresForEvent as ReturnType<typeof vi.fn>).mockResolvedValue(genres);

    const state = await readLiveState(EVENT);

    expect(readGenresForEvent).toHaveBeenCalledTimes(1);
    expect(readGenresForEvent).toHaveBeenCalledWith(EVENT);
    expect(state.genresByArtistId).toBe(genres);
  });

  it('returns the event id, phase and raw phaseStartedAt without computing time-left', async () => {
    // minutesLeftInPhase is phaseClock.ts's job, given phaseStartedAt as an
    // input -- this DAL must not do that date-math itself.
    eventsMaybeSingle.mockResolvedValue({
      data: eventRow({ phase: 'open-floor', phase_started_at: '2026-09-04T20:00:00.000Z' }),
      error: null,
    });

    const state = await readLiveState(EVENT);

    expect(state.event).toEqual({ id: EVENT, phase: 'open-floor', phaseStartedAt: '2026-09-04T20:00:00.000Z' });
  });

  it('passes must-play and blocklist rows through unchanged', async () => {
    const mustPlay = [{ id: 'm1', segment: 'party', title: 'September', artist: 'EWF', moment: null, spotify_track_id: null, spotify_artist_id: null, created_at: '2026-01-01' }];
    const blocklist = [{ id: 'b1', segment: 'party', entry_type: 'song', value: 'X', spotify_id: null, created_at: '2026-01-01' }];
    eventsMaybeSingle.mockResolvedValue({
      data: eventRow({ event_must_play: mustPlay, event_blocklist: blocklist }),
      error: null,
    });

    const state = await readLiveState(EVENT);

    expect(state.mustPlay).toEqual(mustPlay);
    expect(state.blocklist).toEqual(blocklist);
  });

  it('skips the suggestion_votes query entirely when there are no pending suggestions', async () => {
    suggestionsResult.mockResolvedValue({ data: [], error: null });

    await readLiveState(EVENT);

    expect(votesIn).not.toHaveBeenCalled();
  });

  it('skips the spotify_track_artists query entirely when no track ids are referenced', async () => {
    suggestionsResult.mockResolvedValue({ data: [], error: null });

    await readLiveState(EVENT);

    expect(artistsIn).not.toHaveBeenCalled();
  });

  it('throws when the event row is absent', async () => {
    eventsMaybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(readLiveState(EVENT)).rejects.toThrow();
  });

  it('throws on a database error rather than returning a partial state', async () => {
    eventsMaybeSingle.mockResolvedValue({ data: null, error: { code: '42501', message: 'boom' } });

    await expect(readLiveState(EVENT)).rejects.toThrow();
  });
});
