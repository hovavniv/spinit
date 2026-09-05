import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GuestQueue } from './GuestQueue';
import type { VoteActionResult } from '@/lib/live/guestActions';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

describe('GuestQueue', () => {
  it('shows the empty state when nothing is queued', () => {
    render(<GuestQueue sessionId={SESSION_ID} queue={[]} voteAction={vi.fn() as never} />);
    expect(screen.getByText(/nothing queued yet/i)).toBeInTheDocument();
  });

  it("names the row by song and artist, not by the rank badge's number", () => {
    render(
      <GuestQueue
        sessionId={SESSION_ID}
        queue={[{ suggestionId: 's1', title: 'September', artist: 'Earth, Wind & Fire', votes: 19, voted: false, mine: false }]}
        voteAction={vi.fn() as never}
      />,
    );
    expect(screen.getByRole('button', { name: /back september by earth, wind & fire/i })).toBeInTheDocument();
  });

  it('a backing button becomes disabled and does not fire a second vote on a second click', async () => {
    const user = userEvent.setup();
    const voteAction = vi.fn(async (): Promise<VoteActionResult> => ({ ok: true }));
    render(
      <GuestQueue
        sessionId={SESSION_ID}
        queue={[{ suggestionId: 's1', title: 'September', artist: 'Earth, Wind & Fire', votes: 19, voted: false, mine: false }]}
        voteAction={voteAction}
      />,
    );

    const button = screen.getByRole('button', { name: /back september/i });
    await user.click(button);
    expect(await screen.findByRole('button', { name: /backed september/i })).toBeDisabled();

    expect(voteAction).toHaveBeenCalledTimes(1);
    expect(voteAction).toHaveBeenCalledWith(SESSION_ID, 's1');
  });

  it('shows "you backed it" and starts disabled for a row already voted', () => {
    render(
      <GuestQueue
        sessionId={SESSION_ID}
        queue={[{ suggestionId: 's1', title: 'September', artist: 'Earth, Wind & Fire', votes: 19, voted: true, mine: false }]}
        voteAction={vi.fn() as never}
      />,
    );
    expect(screen.getByText(/you backed it/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backed september/i })).toBeDisabled();
  });
});
