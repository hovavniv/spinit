import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { UpcomingEventsList } from './UpcomingEventsList';
import type { UpcomingEvent } from '@/lib/dashboard/types';

const NOW = '2026-09-04T10:00';

const events: UpcomingEvent[] = [
  { id: 'a', coupleNames: 'Maya & Chris', venue: 'Cedar Hall', date: '2026-09-06', status: 'awaiting-couple' },
  { id: 'b', coupleNames: 'Priya & Alex', venue: 'Brookline Barn', date: '2026-09-12', status: 'streaming-connected' },
  { id: 'c', coupleNames: 'Sam & Jordan', venue: 'The Foundry', date: '2026-10-03', status: 'partly-connected' },
];

describe('UpcomingEventsList', () => {
  it('renders one row per event, with the month headings and day tiles', () => {
    render(<UpcomingEventsList events={events} now={NOW} />);

    expect(screen.getByText('SEPTEMBER 2026')).toBeInTheDocument();
    expect(screen.getByText('OCTOBER 2026')).toBeInTheDocument();
    expect(screen.getByText('Maya & Chris')).toBeInTheDocument();
    expect(screen.getByText('Cedar Hall')).toBeInTheDocument();
    // Unpadded: dayTile() returns a plain number, and PastEventsList.tsx
    // already renders it unpadded. '06' would silently disagree with the
    // sibling screen.
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('SUN')).toBeInTheDocument();
  });

  it('renders the badge text for each of the three states', () => {
    render(<UpcomingEventsList events={events} now={NOW} />);

    const badgeOf = (couple: RegExp) =>
      within(screen.getByRole('link', { name: couple }));

    expect(badgeOf(/Maya & Chris/).getByText('No profiles connected')).toBeInTheDocument();
    expect(badgeOf(/Priya & Alex/).getByText('Streaming connected')).toBeInTheDocument();
    expect(badgeOf(/Sam & Jordan/).getByText('1 of 2 connected')).toBeInTheDocument();
  });

  it('links each row at /events/[id], not at the wizard', () => {
    render(<UpcomingEventsList events={events} now={NOW} />);

    expect(screen.getByRole('link', { name: /Maya & Chris/ })).toHaveAttribute(
      'href',
      '/events/a',
    );
  });

  it('shows how far away each event is', () => {
    render(<UpcomingEventsList events={events} now={NOW} />);
    expect(screen.getByText('in 2 days')).toBeInTheDocument();
  });

  it('omits the days-until chip for a past-dated row', () => {
    render(
      <UpcomingEventsList
        events={[{ ...events[0], date: '2026-08-01' }]}
        now={NOW}
      />,
    );
    // Element presence, not text: an empty span and no span both render zero
    // visible text, so a text query cannot tell them apart.
    expect(screen.queryByTestId('days-until-chip')).not.toBeInTheDocument();
  });

  it('filters by the search box', async () => {
    const user = userEvent.setup();
    render(<UpcomingEventsList events={events} now={NOW} />);

    await user.type(screen.getByLabelText(/Search upcoming events/), 'foundry');

    expect(screen.getByText('Sam & Jordan')).toBeInTheDocument();
    expect(screen.queryByText('Maya & Chris')).not.toBeInTheDocument();
  });

  it('filters by a status pill and marks it pressed', async () => {
    const user = userEvent.setup();
    render(<UpcomingEventsList events={events} now={NOW} />);

    const pill = screen.getByRole('button', { name: 'Streaming connected' });
    await user.click(pill);

    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Priya & Alex')).toBeInTheDocument();
    expect(screen.queryByText('Maya & Chris')).not.toBeInTheDocument();
  });

  it('composes the search box and a pill', async () => {
    const user = userEvent.setup();
    render(<UpcomingEventsList events={events} now={NOW} />);

    await user.click(screen.getByRole('button', { name: '1 of 2 connected' }));
    await user.type(screen.getByLabelText(/Search upcoming events/), 'Maya');

    expect(screen.getByText('No events match your search or filters.')).toBeInTheDocument();
  });

  it('distinguishes an empty list from an empty result', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<UpcomingEventsList events={[]} now={NOW} />);
    expect(
      screen.getByText('No upcoming events yet. Create one to get it on the board.'),
    ).toBeInTheDocument();
    unmount();

    render(<UpcomingEventsList events={events} now={NOW} />);
    await user.type(screen.getByLabelText(/Search upcoming events/), 'zzzz');
    expect(screen.getByText('No events match your search or filters.')).toBeInTheDocument();
    expect(
      screen.queryByText('No upcoming events yet. Create one to get it on the board.'),
    ).not.toBeInTheDocument();
  });
});
