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
  it('renders couple names, venue, date, the phase picker, and the Start button', () => {
    renderPreFlight(vi.fn());

    expect(screen.getByText('Dana & Yossi')).toBeInTheDocument();
    expect(screen.getByText(/The Old Winery/)).toBeInTheDocument();
    expect(screen.getByText(/Sep 5, 2026/)).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Event phase' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start event' })).toBeInTheDocument();
  });

  it('says the guest QR code appears once the event starts, and shows no QR here', () => {
    renderPreFlight(vi.fn());

    expect(screen.getByText(/the guest QR code appears once you start/i)).toBeInTheDocument();
  });

  it('defaults the phase picker to Cocktails', () => {
    renderPreFlight(vi.fn());

    expect(screen.getByRole('radio', { name: 'Cocktails' })).toHaveAttribute('aria-checked', 'true');
  });

  it('starts the event with the default phase when Start is pressed without changing it', async () => {
    const user = userEvent.setup();
    const startEvent = vi.fn(async (): Promise<LiveActionResult> => ({ ok: true }));
    renderPreFlight(startEvent);

    await user.click(screen.getByRole('button', { name: 'Start event' }));

    expect(startEvent).toHaveBeenCalledWith(EVENT_ID, 'cocktails');
  });

  it('starts the event with whichever phase was picked', async () => {
    const user = userEvent.setup();
    const startEvent = vi.fn(async (): Promise<LiveActionResult> => ({ ok: true }));
    renderPreFlight(startEvent);

    await user.click(screen.getByRole('radio', { name: 'Dinner' }));
    await user.click(screen.getByRole('button', { name: 'Start event' }));

    expect(startEvent).toHaveBeenCalledWith(EVENT_ID, 'dinner');
  });

  it('shows an error rather than crashing when the event is in the wrong state', async () => {
    const user = userEvent.setup();
    const startEvent = vi.fn(async (): Promise<LiveActionResult> => ({ ok: false, reason: 'wrong-state' }));
    renderPreFlight(startEvent);

    await user.click(screen.getByRole('button', { name: 'Start event' }));

    expect(await screen.findByText(/couldn.t start/i)).toBeInTheDocument();
  });
});
