import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FinalPlaylist } from './FinalPlaylist';
import type { PlayedSong } from '@/lib/events/types';

const SONGS: PlayedSong[] = [
  { position: 1, title: 'At Last', artist: 'Etta James', suggested_by: 'Dana R.' },
  { position: 2, title: 'September', artist: 'Earth, Wind & Fire', suggested_by: null },
];

describe('FinalPlaylist', () => {
  test('renders the card heading', () => {
    render(<FinalPlaylist songs={SONGS} />);
    expect(screen.getByRole('heading', { name: 'Final playlist' })).toBeInTheDocument();
  });

  test('numbers each row from its database position, not its array index', () => {
    render(<FinalPlaylist songs={[{ ...SONGS[0], position: 7 }]} />);
    expect(screen.getByText('7. At Last')).toBeInTheDocument();
  });

  test('renders the artist', () => {
    render(<FinalPlaylist songs={SONGS} />);
    expect(screen.getByText('— Etta James')).toBeInTheDocument();
  });

  test('tags a guest suggestion with the guest name', () => {
    render(<FinalPlaylist songs={SONGS} />);
    expect(screen.getByText('requested by Dana R.')).toBeInTheDocument();
  });

  test('tags an unattributed song as a DJ pick', () => {
    render(<FinalPlaylist songs={SONGS} />);
    expect(screen.getByText('DJ pick')).toBeInTheDocument();
  });

  // A completed event with no songs is a valid recap, not an error. The seed
  // creates exactly one (Ruth & Adam) to make this reachable in the real app.
  test('an empty playlist still renders the card, with an explanation', () => {
    render(<FinalPlaylist songs={[]} />);

    expect(screen.getByRole('heading', { name: 'Final playlist' })).toBeInTheDocument();
    expect(screen.getByText('No songs were logged for this event.')).toBeInTheDocument();
  });

  // Asserted against the card's whole text rather than by querying for a
  // regex: both the row wrapper and the inner track span match /^\d+\. /, so
  // getAllByText would return each row twice and the assertion would be
  // about the DOM's nesting rather than about order.
  test('renders the rows in the order it is given', () => {
    render(<FinalPlaylist songs={SONGS} />);

    const card = screen.getByRole('heading', { name: 'Final playlist' }).parentElement!;
    expect(card.textContent).toMatch(/1\. At Last[\s\S]*2\. September/);
  });
});
