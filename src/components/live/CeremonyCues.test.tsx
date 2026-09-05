import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CeremonyCues } from './CeremonyCues';
import type { MustPlayRow } from '@/lib/events/detailTypes';

function ceremonyRow(overrides: Partial<MustPlayRow> = {}): MustPlayRow {
  return {
    id: 'mp-1',
    segment: 'ceremony',
    title: 'Canon in D',
    artist: 'Pachelbel',
    moment: 'Walking down the aisle',
    spotify_track_id: 'track-aisle',
    spotify_artist_id: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('CeremonyCues', () => {
  it('calls onPlayNow with the title, artist and track id when Play now is pressed', async () => {
    const user = userEvent.setup();
    const onPlayNow = vi.fn(async () => ({ ok: true }));
    render(<CeremonyCues mustPlay={[ceremonyRow()]} played={[]} onPlayNow={onPlayNow} />);

    await user.click(screen.getByRole('button', { name: 'Play now: Canon in D' }));

    expect(onPlayNow).toHaveBeenCalledWith('Canon in D', 'Pachelbel', 'track-aisle');
  });

  it('shows no Play now button once the song has already played', () => {
    render(
      <CeremonyCues
        mustPlay={[ceremonyRow()]}
        played={[{ position: 1, spotifyTrackId: 'track-aisle', artistIds: [] }]}
        onPlayNow={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Play now/ })).not.toBeInTheDocument();
    expect(screen.getByText('Played')).toBeInTheDocument();
  });

  it('shows no button for an unfilled slot', () => {
    render(<CeremonyCues mustPlay={[]} played={[]} onPlayNow={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Play now/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('No song set').length).toBe(2);
  });
});
