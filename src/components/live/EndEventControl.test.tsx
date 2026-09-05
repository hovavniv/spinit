import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

import { EndEventControl } from './EndEventControl';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  push.mockClear();
});

describe('EndEventControl', () => {
  it('shows only the End event button until clicked', () => {
    render(<EndEventControl eventId={EVENT_ID} endAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'End event' })).toBeInTheDocument();
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
  });

  it('asks for confirmation before submitting', async () => {
    const user = userEvent.setup();
    const endAction = vi.fn();
    render(<EndEventControl eventId={EVENT_ID} endAction={endAction} />);

    await user.click(screen.getByRole('button', { name: 'End event' }));

    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(endAction).not.toHaveBeenCalled();
  });

  it('cancel returns to the unconfirmed state without calling the action', async () => {
    const user = userEvent.setup();
    const endAction = vi.fn();
    render(<EndEventControl eventId={EVENT_ID} endAction={endAction} />);

    await user.click(screen.getByRole('button', { name: 'End event' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
    expect(endAction).not.toHaveBeenCalled();
  });

  it('on success, redirects to the recap rather than staying on a now-404 live route', async () => {
    const user = userEvent.setup();
    const endAction = vi.fn().mockResolvedValue({ ok: true });
    render(<EndEventControl eventId={EVENT_ID} endAction={endAction} />);

    await user.click(screen.getByRole('button', { name: 'End event' }));
    await user.click(screen.getByRole('button', { name: 'End it' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/events/${EVENT_ID}/recap`));
  });

  it('on failure, shows the error via role="alert" and does not navigate', async () => {
    const user = userEvent.setup();
    const endAction = vi.fn().mockResolvedValue({ ok: false, message: 'Something went wrong.' });
    render(<EndEventControl eventId={EVENT_ID} endAction={endAction} />);

    await user.click(screen.getByRole('button', { name: 'End event' }));
    await user.click(screen.getByRole('button', { name: 'End it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.');
    expect(push).not.toHaveBeenCalled();
  });

  it('passes the eventId in the submitted form data', async () => {
    const user = userEvent.setup();
    const endAction = vi.fn().mockResolvedValue({ ok: true });
    render(<EndEventControl eventId={EVENT_ID} endAction={endAction} />);

    await user.click(screen.getByRole('button', { name: 'End event' }));
    await user.click(screen.getByRole('button', { name: 'End it' }));

    await waitFor(() => expect(endAction).toHaveBeenCalledTimes(1));
    const submittedFormData = endAction.mock.calls[0][0] as FormData;
    expect(submittedFormData.get('eventId')).toBe(EVENT_ID);
  });
});
