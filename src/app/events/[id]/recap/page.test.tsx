import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
const getProfile = vi.fn();
const getEventRecap = vi.fn();
const maybeSingle = vi.fn();

vi.mock('@/lib/auth/dal', () => ({
  requireUser: () => requireUser(),
  getProfile: () => getProfile(),
}));
vi.mock('@/lib/events/dal', () => ({ getEventRecap: (id: string) => getEventRecap(id) }));
// Mocked at the DAL, matching how `getEventRecap` is handled above, rather
// than by teaching the Supabase double a third query shape. This file tests
// the sidebar identity; `readMostRequestedPlayed`'s own logic is covered in
// `liveDal.test.ts`.
vi.mock('@/lib/live/liveDal', () => ({ readMostRequestedPlayed: async () => null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

import EventRecapPage from './page';

const DJ_ID = '11111111-1111-4111-8111-111111111111';
const PARTNER_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

function recap() {
  return {
    event: { id: EVENT_ID, couple_names: 'Dana & Yossi', venue: 'The Old Winery', event_date: '2026-07-01' },
    songs: [],
  };
}

function props() {
  return { params: Promise.resolve({ id: EVENT_ID }), searchParams: Promise.resolve({}) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getEventRecap.mockResolvedValue(recap());
});

describe('/events/[id]/recap sidebar identity', () => {
  it('shows the DJ business-name fallback and the nav for the DJ', async () => {
    requireUser.mockResolvedValue({ id: DJ_ID, email: 'dj@test.local' });
    getProfile.mockResolvedValue({ full_name: 'DJ Test', business_name: null });
    maybeSingle.mockResolvedValue({ data: { dj_id: DJ_ID } });

    const element = await EventRecapPage(props());
    render(element as React.ReactElement);

    expect(screen.getByText('Independent DJ')).toBeInTheDocument();
    // 'Past events' is the CURRENT nav item on this page, so it renders as a
    // non-link <span aria-current="page">, not an <a> -- 'Dashboard' is the
    // nav item that stays a real link and proves the nav is present at all.
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  });

  // This exact bug shipped once already on /events/[id]: business_name is
  // nullable, and the DJ fallback labelled the couple as a DJ on their own
  // event. A recap is a keepsake the couple may show other people.
  it('shows the couple-facing line and hides the nav for a partner, never the DJ fallback', async () => {
    requireUser.mockResolvedValue({ id: PARTNER_ID, email: 'partner@test.local' });
    getProfile.mockResolvedValue(null);
    maybeSingle.mockResolvedValue({ data: { dj_id: DJ_ID } });

    const element = await EventRecapPage(props());
    render(element as React.ReactElement);

    expect(screen.getByText('Getting married')).toBeInTheDocument();
    expect(screen.queryByText('Independent DJ')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Past events' })).not.toBeInTheDocument();
  });
});
