import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
const getProfile = vi.fn();
const maybeSingle = vi.fn();

// events chain: page.tsx's own read is `.select().eq().maybeSingle()`;
// readLiveState's (only reached for a `live` event, Task 16) is
// `.select().eq().order()x5.maybeSingle()`. One chain object supporting both
// shapes -- `order` and `maybeSingle` both live on it, same pattern as
// liveDal.test.ts -- since it is the same `events` table either way and
// `maybeSingle` is configured to answer both calls with the same superset
// row (page.tsx's own columns plus the embedded relations readLiveState
// reads).
const eventsOrder = vi.fn(() => eventsChain);
const eventsEq = vi.fn(() => eventsChain);
const eventsSelect = vi.fn(() => eventsChain);
const eventsChain = {
  select: eventsSelect,
  eq: eventsEq,
  order: eventsOrder,
  maybeSingle,
};

// song_suggestions: no pending suggestions -- readLiveState's own file has
// exhaustive coverage of this chain; this file only needs it not to throw.
const suggestionsResult = vi.fn(async () => ({ data: [], error: null }));
const suggestionsOrder2 = vi.fn(() => suggestionsResult());
const suggestionsOrder1 = vi.fn(() => ({ order: suggestionsOrder2 }));
const suggestionsEq2 = vi.fn(() => ({ order: suggestionsOrder1 }));
const suggestionsEq1 = vi.fn(() => ({ eq: suggestionsEq2 }));
const suggestionsSelect = vi.fn(() => ({ eq: suggestionsEq1 }));

const votesIn = vi.fn(async () => ({ data: [], error: null }));
const votesSelect = vi.fn(() => ({ in: votesIn }));

const artistsResult = vi.fn(async () => ({ data: [], error: null }));
const artistsOrder2 = vi.fn(() => artistsResult());
const artistsOrder1 = vi.fn(() => ({ order: artistsOrder2 }));
const artistsIn = vi.fn(() => ({ order: artistsOrder1 }));
const artistsSelect = vi.fn(() => ({ in: artistsIn }));

const tracksResult = vi.fn(async () => ({ data: [], error: null }));
const tracksIn = vi.fn(() => tracksResult());
const tracksSelect = vi.fn(() => ({ in: tracksIn }));

const from = vi.fn((table: string) => {
  if (table === 'events') return eventsChain;
  if (table === 'song_suggestions') return { select: suggestionsSelect };
  if (table === 'suggestion_votes') return { select: votesSelect };
  if (table === 'spotify_track_artists') return { select: artistsSelect };
  if (table === 'spotify_tracks') return { select: tracksSelect };
  throw new Error(`page.test.tsx: unexpected table "${table}"`);
});

vi.mock('@/lib/auth/dal', () => ({
  requireUser: () => requireUser(),
  getProfile: () => getProfile(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from }),
}));
vi.mock('@/lib/genres/genresDal', () => ({
  readGenresForEvent: vi.fn(async () => ({})),
}));
vi.mock('@/lib/live/liveActions', () => ({ startEvent: vi.fn(), setPhase: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import LiveEventPage from './page';

const DJ_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DJ_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

function event(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: EVENT_ID,
    dj_id: DJ_ID,
    couple_names: 'Dana & Yossi',
    venue: 'The Old Winery',
    event_date: '2026-09-05',
    start_time: null,
    status: 'upcoming',
    phase: null,
    phase_started_at: null,
    join_token: null,
    event_must_play: [],
    event_blocklist: [],
    played_songs: [],
    ...overrides,
  };
}

function pageProps(id: string) {
  return { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) };
}

async function renderPage(id: string) {
  const element = await LiveEventPage(pageProps(id));
  return render(element as React.ReactElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: DJ_ID, email: 'dj@test.local' });
  getProfile.mockResolvedValue({ full_name: 'DJ Test', business_name: 'Test Sounds' });
});

describe('/events/[id]/live', () => {
  it('renders the pre-flight with a Start button for an upcoming event', async () => {
    maybeSingle.mockResolvedValue({ data: event({ status: 'upcoming' }) });

    await renderPage(EVENT_ID);

    expect(screen.getByRole('button', { name: 'Start event' })).toBeInTheDocument();
  });

  it('renders the live view instead of the pre-flight for a live event', async () => {
    maybeSingle.mockResolvedValue({ data: event({ status: 'live', phase: 'cocktails' }) });

    await renderPage(EVENT_ID);

    expect(screen.queryByRole('button', { name: 'Start event' })).not.toBeInTheDocument();
  });

  it('404s for a draft event', async () => {
    maybeSingle.mockResolvedValue({ data: event({ status: 'draft' }) });

    await expect(LiveEventPage(pageProps(EVENT_ID))).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NOT_FOUND/,
    );
  });

  it('404s for a completed event', async () => {
    maybeSingle.mockResolvedValue({ data: event({ status: 'completed' }) });

    await expect(LiveEventPage(pageProps(EVENT_ID))).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NOT_FOUND/,
    );
  });

  it('404s for a partner on the event, not a 403', async () => {
    requireUser.mockResolvedValue({ id: 'partner-1', email: 'partner@test.local' });
    // RLS would let a partner select this row; the app-level dj_id check is
    // what refuses them here.
    maybeSingle.mockResolvedValue({ data: event({ status: 'upcoming', dj_id: DJ_ID }) });

    await expect(LiveEventPage(pageProps(EVENT_ID))).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NOT_FOUND/,
    );
  });

  it('404s for a DJ who owns a different event', async () => {
    requireUser.mockResolvedValue({ id: OTHER_DJ_ID, email: 'other-dj@test.local' });
    maybeSingle.mockResolvedValue({ data: event({ status: 'upcoming', dj_id: DJ_ID }) });

    await expect(LiveEventPage(pageProps(EVENT_ID))).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NOT_FOUND/,
    );
  });

  it('404s for a non-uuid id before ever querying the database', async () => {
    await expect(LiveEventPage(pageProps('banana'))).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NOT_FOUND/,
    );
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('404s when no such event exists', async () => {
    maybeSingle.mockResolvedValue({ data: null });

    await expect(LiveEventPage(pageProps(EVENT_ID))).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NOT_FOUND/,
    );
  });
});
