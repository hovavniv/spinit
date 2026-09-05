import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RequestQueue } from './RequestQueue';
import type { RankedSong } from '@/lib/live/liveTypes';

function row(overrides: Partial<RankedSong> = {}): RankedSong {
  return {
    suggestion: {
      id: 's1',
      spotifyTrackId: 'track-1',
      title: 'September',
      artist: 'Earth, Wind & Fire',
      resolvedTitle: null,
      resolvedArtist: null,
      artistIds: [],
      requesters: 3,
      createdAt: '2026-09-05T10:00:00.000Z',
      suggestedByName: 'Guest',
    },
    rank: 1,
    score: 3,
    reasons: [{ kind: 'requesters', count: 3 }],
    blocked: null,
    ...overrides,
  };
}

describe('RequestQueue', () => {
  it('calls onPlay with the suggestion id when Play is pressed', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn(async () => ({ ok: true }));
    const onSkip = vi.fn(async () => ({ ok: true }));
    render(<RequestQueue queue={[row()]} onPlay={onPlay} onSkip={onSkip} />);

    await user.click(screen.getByRole('button', { name: 'Play September' }));

    expect(onPlay).toHaveBeenCalledWith('s1');
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('calls onSkip with the suggestion id when Skip is pressed', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn(async () => ({ ok: true }));
    const onSkip = vi.fn(async () => ({ ok: true }));
    render(<RequestQueue queue={[row()]} onPlay={onPlay} onSkip={onSkip} />);

    await user.click(screen.getByRole('button', { name: 'Skip September' }));

    expect(onSkip).toHaveBeenCalledWith('s1');
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('shows an inline error rather than failing silently when the action reports wrong-state', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn(async () => ({ ok: false }));
    render(<RequestQueue queue={[row()]} onPlay={onPlay} onSkip={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Play September' }));

    expect(await screen.findByText(/couldn.t update/i)).toBeInTheDocument();
  });
});
