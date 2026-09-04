import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
const getProfile = vi.fn();
const maybeSingle = vi.fn();

vi.mock('@/lib/auth/dal', () => ({
  requireUser: () => requireUser(),
  getProfile: () => getProfile(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}));
vi.mock('@/lib/live/liveActions', () => ({ startEvent: vi.fn() }));
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
    status: 'upcoming',
    phase: null,
    phase_started_at: null,
    join_token: null,
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
