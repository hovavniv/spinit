import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EndEventSection } from './EndEventSection';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

describe('EndEventSection', () => {
  it('renders nothing when the event cannot be ended', () => {
    const { container } = render(
      <EndEventSection eventId={EVENT_ID} canEnd={false} endAction={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('requires a second click to fire the action', async () => {
    const user = userEvent.setup();
    const endAction = vi.fn(async (_formData: FormData) => ({ ok: true as const }));

    render(<EndEventSection eventId={EVENT_ID} canEnd endAction={endAction} />);

    await user.click(screen.getByRole('button', { name: 'End event' }));
    expect(endAction).not.toHaveBeenCalled();
    expect(screen.getByText(/closes the event/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'End it' }));
    expect(endAction).toHaveBeenCalledTimes(1);
  });

  it('cancels back to the first step without calling the action', async () => {
    const user = userEvent.setup();
    const endAction = vi.fn(async (_formData: FormData) => ({ ok: true as const }));

    render(<EndEventSection eventId={EVENT_ID} canEnd endAction={endAction} />);

    await user.click(screen.getByRole('button', { name: 'End event' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(endAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'End event' })).toBeInTheDocument();
  });
});
