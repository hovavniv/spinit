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

// song_suggestions/suggestion_votes/spotify_track_artists/spotify_tracks: no
// rows either way -- readLiveState's and readActivity's own test files each
// have exhaustive coverage of their exact chain shapes (which differ from
// each other -- see readActivity.test.ts's header comment on why). This
// file's own tests only render the page shell (Start button, 404s) and never
// assert on activity/queue content, so a generic auto-resolving stand-in
// that answers ANY chained call with an empty result is sufficient here and
// does not need to hard-code either function's exact method sequence.
function emptyChain(): unknown {
  const target: Record<string, unknown> = {};
  const handler: ProxyHandler<typeof target> = {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: { data: never[]; error: null }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
      }
      return () => proxy;
    },
  };
  const proxy = new Proxy(target, handler);
  return proxy;
}

const from = vi.fn((table: string) => {
  if (table === 'events') return eventsChain;
  if (
    table === 'song_suggestions' ||
    table === 'suggestion_votes' ||
    table === 'spotify_track_artists' ||
    table === 'spotify_tracks'
  ) {
    return { select: () => emptyChain() };
  }
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
vi.mock('@/lib/live/liveActions', () => ({
  startEvent: vi.fn(),
  setPhase: vi.fn(),
  playSuggestion: vi.fn(),
  skipSuggestion: vi.fn(),
  playPick: vi.fn(),
}));
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
    maybeSingle.mockResolvedValue({ data: event({ status: 'live', phase: 'dinner' }) });

    await renderPage(EVENT_ID);

    expect(screen.queryByRole('button', { name: 'Start event' })).not.toBeInTheDocument();
  });

  it('with a live event but no join_token, shows the missing-link note (not a QR for a broken URL) and logs the anomaly', async () => {
    maybeSingle.mockResolvedValue({ data: event({ status: 'live', phase: 'dinner', join_token: null }) });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await renderPage(EVENT_ID);

    expect(screen.getByText('No guest link for this event')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guest QR code' })).not.toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith(
      'live page: live event has no join_token',
      expect.objectContaining({ eventId: EVENT_ID }),
    );

    errorSpy.mockRestore();
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
