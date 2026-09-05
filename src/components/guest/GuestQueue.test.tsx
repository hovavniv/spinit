import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GuestQueue } from './GuestQueue';
import type { VoteActionResult } from '@/lib/live/guestActions';

const TOKEN = 'a'.repeat(22);

describe('GuestQueue', () => {
  it('shows the empty state when nothing is queued', () => {
    render(<GuestQueue token={TOKEN} queue={[]} voteAction={vi.fn() as never} />);
    expect(screen.getByText(/nothing queued yet/i)).toBeInTheDocument();
  });

  it("names the row by song and artist, not by the rank badge's number", () => {
    render(
      <GuestQueue
        token={TOKEN}
        queue={[{ suggestionId: 's1', title: 'September', artist: 'Earth, Wind & Fire', votes: 19, voted: false, mine: false }]}
        voteAction={vi.fn() as never}
      />,
    );
    expect(screen.getByRole('button', { name: /back september by earth, wind & fire/i })).toBeInTheDocument();
  });

  // F3: voteAction is called with the TOKEN, never a session id -- a
  // sessionId prop on this 'use client' component would be serialized into
  // the RSC payload and readable by any script on the page.
  it('a backing button becomes disabled, does not fire a second vote on a second click, and calls voteAction with the token', async () => {
    const user = userEvent.setup();
    const voteAction = vi.fn(async (): Promise<VoteActionResult> => ({ ok: true }));
    render(
      <GuestQueue
        token={TOKEN}
        queue={[{ suggestionId: 's1', title: 'September', artist: 'Earth, Wind & Fire', votes: 19, voted: false, mine: false }]}
        voteAction={voteAction}
      />,
    );

    const button = screen.getByRole('button', { name: /back september/i });
    await user.click(button);
    expect(await screen.findByRole('button', { name: /backed september/i })).toBeDisabled();

    expect(voteAction).toHaveBeenCalledTimes(1);
    expect(voteAction).toHaveBeenCalledWith(TOKEN, 's1');
  });

  // M2: voteAction's result was previously discarded entirely, so a failed
  // vote rendered "Backed ✓" with no error -- after the DJ ends the event,
  // every tap would silently "succeed" this way.
  it('rolls back to "Back it" and surfaces an error when voteAction fails', async () => {
    const user = userEvent.setup();
    const voteAction = vi.fn(
      async (): Promise<VoteActionResult> => ({ ok: false, code: 'event_not_live', message: "This event has ended." }),
    );
    render(
      <GuestQueue
        token={TOKEN}
        queue={[{ suggestionId: 's1', title: 'September', artist: 'Earth, Wind & Fire', votes: 19, voted: false, mine: false }]}
        voteAction={voteAction}
      />,
    );

    await user.click(screen.getByRole('button', { name: /back september/i }));

    expect(await screen.findByText('This event has ended.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^back september by earth, wind & fire$/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /backed september/i })).not.toBeInTheDocument();
  });

  it('shows "you backed it" and starts disabled for a row already voted', () => {
    render(
      <GuestQueue
        token={TOKEN}
        queue={[{ suggestionId: 's1', title: 'September', artist: 'Earth, Wind & Fire', votes: 19, voted: true, mine: false }]}
        voteAction={vi.fn() as never}
      />,
    );
    expect(screen.getByText(/you backed it/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backed september/i })).toBeDisabled();
  });
});
