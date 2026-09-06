import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PreFlight } from './PreFlight';
import type { LiveActionResult } from '@/lib/live/liveActions';

// PreFlight takes startEvent as a prop, never `vi.mock('@/lib/live/liveActions')` —
// same pattern LoginForm uses for its own server action (design 6, design 10.3).

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

function renderPreFlight(startEvent: (eventId: string, phase: string) => Promise<LiveActionResult>) {
  return render(
    <PreFlight
      eventId={EVENT_ID}
      coupleNames="Dana & Yossi"
      venue="The Old Winery"
      eventDate="Sep 5, 2026"
      startEvent={startEvent as never}
    />,
  );
}

describe('PreFlight', () => {
  it('renders couple names, venue, date, and the Start button', () => {
    renderPreFlight(vi.fn());

    expect(screen.getByText('Dana & Yossi')).toBeInTheDocument();
    expect(screen.getByText(/The Old Winery/)).toBeInTheDocument();
    expect(screen.getByText(/Sep 5, 2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start event' })).toBeInTheDocument();
  });

  it('says the guest QR code appears once the event starts, and shows no QR here', () => {
    renderPreFlight(vi.fn());

    expect(screen.getByText(/the guest QR code appears once you start/i)).toBeInTheDocument();
  });

  // No phase picker here any more -- an event always starts in Cocktails and
  // the DJ changes phase on the live screen, where they can see the room.
  it('offers no phase control', () => {
    renderPreFlight(vi.fn());

    expect(screen.queryByRole('radiogroup', { name: 'Event phase' })).not.toBeInTheDocument();
  });

  it('starts the event in Cocktails', async () => {
    const user = userEvent.setup();
    const startEvent = vi.fn(async (): Promise<LiveActionResult> => ({ ok: true }));
    renderPreFlight(startEvent);

    await user.click(screen.getByRole('button', { name: 'Start event' }));

    expect(startEvent).toHaveBeenCalledWith(EVENT_ID, 'cocktails');
  });

  it('shows an error rather than crashing when the event is in the wrong state', async () => {
    const user = userEvent.setup();
    const startEvent = vi.fn(async (): Promise<LiveActionResult> => ({ ok: false, reason: 'wrong-state' }));
    renderPreFlight(startEvent);

    await user.click(screen.getByRole('button', { name: 'Start event' }));

    expect(await screen.findByText(/couldn.t start/i)).toBeInTheDocument();
  });
});
