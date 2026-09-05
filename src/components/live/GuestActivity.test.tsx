import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GuestActivity, type LiveActivityItem } from './GuestActivity';

function item(overrides: Partial<LiveActivityItem> = {}): LiveActivityItem {
  return {
    id: 'requested-s1',
    verb: 'requested',
    guestName: 'Noa',
    title: 'September',
    artist: 'Earth, Wind & Fire',
    createdAt: '2026-09-04T20:00:00.000Z',
    ...overrides,
  };
}

describe('GuestActivity', () => {
  it('shows "No activity yet" when the feed is empty', () => {
    render(<GuestActivity activity={[]} />);

    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('renders a "requested" item as "<guest> requested <title>"', () => {
    render(<GuestActivity activity={[item({ verb: 'requested', guestName: 'Noa', title: 'September' })]} />);

    expect(screen.getByText('Noa requested September')).toBeInTheDocument();
  });

  it('renders a "backed" item as "<guest> backed <title>"', () => {
    render(
      <GuestActivity
        activity={[item({ id: 'backed-s1-g1', verb: 'backed', guestName: 'Eitan', title: 'Uptown Funk' })]}
      />,
    );

    expect(screen.getByText('Eitan backed Uptown Funk')).toBeInTheDocument();
  });

  it('renders multiple items in the order given (the DAL is responsible for sort order, not this component)', () => {
    render(
      <GuestActivity
        activity={[
          item({ id: 'a', guestName: 'Noa', title: 'September' }),
          item({ id: 'b', guestName: 'Eitan', title: 'Uptown Funk' }),
        ]}
      />,
    );

    const items = screen.getAllByRole('listitem').map((el) => el.textContent);
    expect(items).toEqual(['Noa requested September', 'Eitan requested Uptown Funk']);
  });

  it('keeps aria-live="polite" on the list', () => {
    render(<GuestActivity activity={[item()]} />);

    const list = screen.getByRole('list');
    expect(list).toHaveAttribute('aria-live', 'polite');
  });
});
