import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StartEventSection } from './StartEventSection';
import type { LiveActionResult } from '@/lib/live/liveActions';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StartEventSection', () => {
  it('renders nothing when canStart is false', () => {
    const { container } = render(
      <StartEventSection eventId={EVENT_ID} canStart={false} startEventAction={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the Start button when canStart is true', () => {
    render(<StartEventSection eventId={EVENT_ID} canStart={true} startEventAction={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Start event' })).toBeInTheDocument();
  });

  // The phase picker used to live here as well as on the live screen. It was
  // removed: an event always begins in Cocktails, and asking the DJ to commit
  // to a phase before the first guest arrives duplicated a control that is one
  // click away the moment the event goes live. This pins the phase the action
  // is actually called with, so a future edit cannot quietly start events in
  // some other phase.
  it('starts the event in Cocktails and navigates to the live screen on success', async () => {
    const user = userEvent.setup();
    const startEventAction = vi.fn(async (): Promise<LiveActionResult> => ({ ok: true }));
    render(<StartEventSection eventId={EVENT_ID} canStart={true} startEventAction={startEventAction} />);

    await user.click(screen.getByRole('button', { name: 'Start event' }));

    expect(startEventAction).toHaveBeenCalledWith(EVENT_ID, 'cocktails');
    expect(push).toHaveBeenCalledWith(`/events/${EVENT_ID}/live`);
  });

  it('offers no phase control', () => {
    render(<StartEventSection eventId={EVENT_ID} canStart={true} startEventAction={vi.fn()} />);

    expect(screen.queryByRole('radiogroup', { name: 'Event phase' })).not.toBeInTheDocument();
  });

  it('shows an error and does not navigate when the event is in the wrong state', async () => {
    const user = userEvent.setup();
    const startEventAction = vi.fn(
      async (): Promise<LiveActionResult> => ({ ok: false, reason: 'wrong-state' }),
    );
    render(<StartEventSection eventId={EVENT_ID} canStart={true} startEventAction={startEventAction} />);

    await user.click(screen.getByRole('button', { name: 'Start event' }));

    expect(await screen.findByText(/couldn.t start/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
