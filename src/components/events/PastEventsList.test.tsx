import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PastEventsList } from './PastEventsList';
import type { PastEventRow } from '@/lib/events/types';

const EVENTS: PastEventRow[] = [
  {
    id: 'noa',
    couple_names: 'Noa & Eitan',
    venue: 'Franklin Hall',
    event_date: '2026-07-18',
    songs_played: 10,
  },
  {
    id: 'claire',
    couple_names: 'Claire & Ben',
    venue: 'Rooftop at Dune',
    event_date: '2026-06-06',
    songs_played: 8,
  },
];

const searchBox = () => screen.getByRole('textbox', { name: /search past events/i });

describe('PastEventsList', () => {
  test('renders a month heading per month and a row per event', () => {
    render(<PastEventsList events={EVENTS} />);

    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(screen.getByText('June 2026')).toBeInTheDocument();
    expect(screen.getByText('Noa & Eitan')).toBeInTheDocument();
    expect(screen.getByText('Claire & Ben')).toBeInTheDocument();
  });

  test('each row links to that event recap', () => {
    render(<PastEventsList events={EVENTS} />);

    expect(screen.getByRole('link', { name: /Noa & Eitan/ })).toHaveAttribute(
      'href',
      '/events/noa/recap',
    );
  });

  test('shows the song count', () => {
    render(<PastEventsList events={EVENTS} />);
    expect(screen.getByText('10 songs played')).toBeInTheDocument();
  });

  test('typing filters by couple name', async () => {
    const user = userEvent.setup();
    render(<PastEventsList events={EVENTS} />);

    await user.type(searchBox(), 'claire');

    expect(screen.getByText('Claire & Ben')).toBeInTheDocument();
    expect(screen.queryByText('Noa & Eitan')).not.toBeInTheDocument();
  });

  test('typing filters by venue', async () => {
    const user = userEvent.setup();
    render(<PastEventsList events={EVENTS} />);

    await user.type(searchBox(), 'franklin');

    expect(screen.getByText('Noa & Eitan')).toBeInTheDocument();
    expect(screen.queryByText('Claire & Ben')).not.toBeInTheDocument();
  });

  test('a query matching nothing shows the search-empty message', async () => {
    const user = userEvent.setup();
    render(<PastEventsList events={EVENTS} />);

    await user.type(searchBox(), 'zzzzz');

    expect(screen.getByText('No events match your search.')).toBeInTheDocument();
  });

  // The deviation from the artboard (design §8): a DJ with no events at all
  // must not be told that nothing matches a search they never made.
  test('no events at all shows the never-had-any message, not the search one', () => {
    render(<PastEventsList events={[]} />);

    expect(screen.getByText(/No past events yet/i)).toBeInTheDocument();
    expect(screen.queryByText('No events match your search.')).not.toBeInTheDocument();
  });

  // Design §8 deviation 1 is a CLAIM about accessibility, and an unasserted
  // claim is one a refactor can silently delete. This pins the region itself,
  // not just the message text -- the message can be found without the region
  // existing, which is exactly the regression worth catching.
  test('the search-result message lives in a polite live region', () => {
    const { container } = render(<PastEventsList events={EVENTS} />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();

    fireEvent.change(screen.getByLabelText(/search past events/i), {
      target: { value: 'zzzznomatch' },
    });
    expect(region).toHaveTextContent('No events match your search.');
  });
});
