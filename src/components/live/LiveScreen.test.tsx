import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ---------------------------------------------------------------------------
   WHY THIS FILE MOCKS SUPABASE, NOT readLiveState/rankQueue (Task 16).

   A screen-level test built from a hand-constructed, DAL-shaped fixture
   handed directly to <LiveScreen> would stay green even if readLiveState
   stopped reading a table it should read -- exactly the TasteProfile failure
   already recorded in this repo's history. Instead this mocks the Supabase
   client at the boundary (the same pattern liveDal.test.ts uses) and lets the
   REAL readLiveState and the REAL rankQueue run, so the render is downstream
   of the actual DAL and the actual ranking engine.
   --------------------------------------------------------------------------- */

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

// ---- events chain: .select().eq().order()x5.maybeSingle() ----
const eventsMaybeSingle = vi.fn();
const eventsOrder = vi.fn(() => eventsChain);
const eventsEq = vi.fn(() => eventsChain);
const eventsSelect = vi.fn(() => eventsChain);
const eventsChain = {
  select: eventsSelect,
  eq: eventsEq,
  order: eventsOrder,
  maybeSingle: eventsMaybeSingle,
};

// ---- song_suggestions chain: .select().eq().eq().order().order() ----
const suggestionsResult = vi.fn();
const suggestionsOrder2 = vi.fn(() => suggestionsResult());
const suggestionsOrder1 = vi.fn(() => ({ order: suggestionsOrder2 }));
const suggestionsEq2 = vi.fn(() => ({ order: suggestionsOrder1 }));
const suggestionsEq1 = vi.fn(() => ({ eq: suggestionsEq2 }));
const suggestionsSelect = vi.fn(() => ({ eq: suggestionsEq1 }));

// ---- suggestion_votes chain: .select().in() ----
const votesIn = vi.fn();
const votesSelect = vi.fn(() => ({ in: votesIn }));

// ---- spotify_track_artists chain: .select().in().order().order() ----
const artistsResult = vi.fn();
const artistsOrder2 = vi.fn(() => artistsResult());
const artistsOrder1 = vi.fn(() => ({ order: artistsOrder2 }));
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
  throw new Error(`LiveScreen.test.tsx: unexpected table "${table}"`);
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from })),
}));

vi.mock('@/lib/genres/genresDal', () => ({
  // {} for every artist: every suggestion's genre is "not yet checked", which
  // is a real, valid readGenresForEvent outcome and keeps rank.ts's genre-fit
  // term out of the way of the assertions below.
  readGenresForEvent: vi.fn(async () => ({})),
}));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

import { readLiveState } from '@/lib/live/liveDal';
import { rankQueue } from '@/lib/live/rank';
import { LiveScreen } from './LiveScreen';

const TRACK_GOOD = 'trackgoodgoodgoodgood1';
const TRACK_BAD = 'trackbadbadbadbadbad02';

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    phase: 'dinner',
    phase_started_at: '2026-09-04T18:00:00.000Z',
    event_must_play: [],
    event_blocklist: [
      {
        id: 'b1',
        segment: 'reception',
        entry_type: 'song',
        value: 'The Chicken Dance',
        spotify_id: TRACK_BAD,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    played_songs: [],
    ...overrides,
  };
}

function suggestionRows() {
  return [
    {
      id: 's1',
      spotify_track_id: TRACK_GOOD,
      title: 'guest typed this',
      artist: 'guest artist',
      created_at: '2026-01-01T00:00:00Z',
      guest_sessions: { display_name: 'Noa' },
    },
    {
      id: 's2',
      spotify_track_id: TRACK_BAD,
      title: 'Bad Song',
      artist: 'Bad Artist',
      created_at: '2026-01-01T00:00:01Z',
      guest_sessions: { display_name: 'Eitan' },
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  refresh.mockClear();
  // LiveScreen now owns a useLivePoll (Task 16a) that fires one fetch on
  // mount -- stub it so these render-only tests never hit a real network
  // call. A non-ok response is fine: the hook's own failure handling is
  // covered by useLivePoll.test.ts, not here.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })));
  eventsMaybeSingle.mockResolvedValue({ data: eventRow(), error: null });
  suggestionsResult.mockResolvedValue({ data: suggestionRows(), error: null });
  votesIn.mockResolvedValue({
    data: [{ suggestion_id: 's1' }, { suggestion_id: 's1' }],
    error: null,
  });
  artistsResult.mockResolvedValue({
    data: [
      { spotify_track_id: TRACK_GOOD, spotify_artist_id: 'artist-1', artist_name: 'Earth, Wind & Fire' },
      { spotify_track_id: TRACK_BAD, spotify_artist_id: 'artist-2', artist_name: 'Bad Artist' },
    ],
    error: null,
  });
  tracksResult.mockResolvedValue({
    data: [{ spotify_track_id: TRACK_GOOD, title: 'September', artist: 'Earth, Wind & Fire' }],
    error: null,
  });
});

/**
 * The harness: calls the REAL readLiveState (mocked-Supabase-backed) and the
 * REAL rankQueue, then hands their output to <LiveScreen> as props -- so the
 * render is downstream of the actual DAL and ranking engine, never a
 * hand-built DAL-shaped fixture.
 */
async function renderLiveScreen() {
  const state = await readLiveState(EVENT_ID);
  const { queue, blocked } = rankQueue({
    suggestions: state.suggestions,
    mustPlay: state.mustPlay,
    blocklist: state.blocklist,
    genresByArtistId: state.genresByArtistId,
    played: state.played,
    phase: state.event.phase,
    minutesLeftInPhase: null,
  });

  const mustPlayProgress = { played: 0, total: state.mustPlay.length };
  const setPhase = vi.fn(async () => ({ ok: true as const }));
  const playSuggestion = vi.fn(async () => ({ ok: true as const, position: 1, wasAlreadyPlayed: false }));
  const skipSuggestion = vi.fn(async () => ({ ok: true as const }));
  const playPick = vi.fn(async () => ({ ok: true as const, position: 1, wasAlreadyPlayed: false }));

  render(
    <LiveScreen
      eventId={EVENT_ID}
      coupleNames="Noa & Eitan"
      venue="The Vineyard"
      eventDate="2026-09-04"
      startTime="18:00"
      now="2026-09-04T19:00:00.000Z"
      phase={state.event.phase}
      setPhase={setPhase}
      playSuggestion={playSuggestion}
      skipSuggestion={skipSuggestion}
      playPick={playPick}
      queue={queue}
      blocked={blocked}
      mustPlay={state.mustPlay}
      blocklist={state.blocklist}
      played={state.played}
      mustPlayProgress={mustPlayProgress}
      activity={[]}
    />,
  );

  return { queue, blocked, setPhase, playSuggestion, skipSuggestion, playPick };
}

describe('LiveScreen', () => {
  it('renders the resolved display title/artist over the guest\'s own text when resolved', async () => {
    await renderLiveScreen();

    // s1 resolved via spotify_tracks -- the resolved pair must win.
    expect(screen.getByText(/September/)).toBeInTheDocument();
    expect(screen.getByText(/Earth, Wind & Fire/)).toBeInTheDocument();
    // the guest's own unresolved text for s1 must NOT appear anywhere.
    expect(screen.queryByText(/guest typed this/)).not.toBeInTheDocument();
    expect(screen.queryByText('guest artist')).not.toBeInTheDocument();
  });

  it('renders the guest\'s own title when resolvedTitle is null', async () => {
    await renderLiveScreen();

    // s2 has no spotify_tracks row -- resolvedTitle/resolvedArtist stay null,
    // so the guest's own text is what must render (it is blocked, so it
    // appears under the Blocked section, not the queue). Matched with
    // getAllByText rather than getByText: the blocked reason clause also
    // contains "Bad Song" as a quoted substring, so more than one match is
    // expected and correct here, not a collision to resolve away.
    expect(screen.getAllByText(/Bad Song/).length).toBeGreaterThan(0);
  });

  it('shows the why line under the visible queue row, with the actual reason text', async () => {
    await renderLiveScreen();

    // s1: 2 votes, genre not yet checked (readGenresForEvent -> {}) --
    // renderReasons([{requesters,count:2},{genre-pending}]).
    expect(
      screen.getByText("2 people asked for it, and its genre hasn't been checked yet."),
    ).toBeInTheDocument();
  });

  it('shows the blocked reason text under the Blocked section, not silently dropped', async () => {
    await renderLiveScreen();

    // s2 is blocked as a song match; findBlockReason uses the guest's own
    // (unresolved) title, per rank.ts.
    expect(screen.getByText('"Bad Song" is on the do-not-play list.')).toBeInTheDocument();
  });

  it('gives a Play button an accessible name that includes the song title', async () => {
    await renderLiveScreen();

    expect(screen.getByRole('button', { name: /Play .*September/ })).toBeInTheDocument();
  });

  it('renders the phase picker as a radiogroup', async () => {
    await renderLiveScreen();

    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('marks the guest activity region aria-live="polite"', async () => {
    const { container } = render(
      <LiveScreen
        eventId={EVENT_ID}
        coupleNames="Noa & Eitan"
        venue="The Vineyard"
        eventDate="2026-09-04"
        startTime="18:00"
        now="2026-09-04T19:00:00.000Z"
        phase="dinner"
        setPhase={vi.fn(async () => ({ ok: true as const }))}
        playSuggestion={vi.fn(async () => ({ ok: true as const, position: 1, wasAlreadyPlayed: false }))}
        skipSuggestion={vi.fn(async () => ({ ok: true as const }))}
        playPick={vi.fn(async () => ({ ok: true as const, position: 1, wasAlreadyPlayed: false }))}
        queue={[]}
        blocked={[]}
        mustPlay={[]}
        blocklist={[]}
        played={[]}
        mustPlayProgress={{ played: 0, total: 0 }}
        activity={[]}
      />,
    );

    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});

describe('LiveScreen live-poll integration (Task 17: the played staleness fix)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a must-play row turns green on the next poll, without a page refresh', async () => {
    eventsMaybeSingle.mockResolvedValue({
      data: eventRow({
        event_must_play: [
          {
            id: 'mp-1',
            segment: 'party',
            title: 'September',
            artist: 'Earth, Wind & Fire',
            moment: null,
            spotify_track_id: TRACK_GOOD,
            spotify_artist_id: null,
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
      error: null,
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        queue: [],
        blocked: [],
        activity: [],
        mustPlayProgress: { played: 1, total: 1 },
        unresolvedArtistIds: [],
        played: [{ position: 1, spotifyTrackId: TRACK_GOOD, artistIds: ['artist-1'] }],
        now: '2026-09-04T20:00:00.000Z',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await renderLiveScreen();

    // Before any poll: the must-play is unplayed, so it appears in "Must
    // play", not "Played".
    const mustPlayColumn = screen.getByText('Must play').closest('div')!;
    expect(mustPlayColumn.textContent).toContain('September');
    const playedColumn = screen.getByText('Played').closest('div')!;
    expect(playedColumn.textContent).not.toContain('September');

    await vi.advanceTimersByTimeAsync(8_000);

    await waitFor(() => {
      const nowPlayedColumn = screen.getByText('Played').closest('div')!;
      expect(nowPlayedColumn.textContent).toContain('September');
    });
    const nowMustPlayColumn = screen.getByText('Must play').closest('div')!;
    expect(nowMustPlayColumn.textContent).not.toContain('September');
  });
});
