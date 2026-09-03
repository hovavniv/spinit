import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { InviteSent } from './InviteSent';
import type { WizardEvent } from '@/lib/events/newEventTypes';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

const event: WizardEvent = {
  id: EVENT_ID,
  couple_names: 'Alex & Sam',
  partner1_name: 'Alex',
  partner2_name: 'Sam',
  event_date: '2026-10-04',
  venue: 'Brookline Barn',
  guest_count: 120,
  status: 'upcoming',
  partners: [
    { slot: 1, display_name: 'Alex', invite_email: 'alex@example.org' },
    { slot: 2, display_name: 'Sam', invite_email: 'sam@example.org' },
  ],
};

const links = {
  1: `https://spinit.test/invite/${EVENT_ID}/1`,
  2: `https://spinit.test/invite/${EVENT_ID}/2`,
} as const;

describe('InviteSent', () => {
  test('renders one link per partner', () => {
    render(<InviteSent event={event} links={links} />);

    expect(screen.getByText(links[1])).toBeInTheDocument();
    expect(screen.getByText(links[2])).toBeInTheDocument();
  });

  test('reads the guest count', () => {
    // guest_count's only reader. Without this the column would be written by
    // one form and read only by that same form to refill itself (design §4.3).
    render(<InviteSent event={event} links={links} />);

    expect(screen.getByText('120 guests')).toBeInTheDocument();
  });

  test('does not claim an email was sent', () => {
    render(<InviteSent event={event} links={links} />);

    expect(screen.getByText(/Links ready/i)).toBeInTheDocument();
    expect(screen.queryByText(/Invite sent to/i)).not.toBeInTheDocument();
  });

  test('offers both artboard exits', () => {
    render(<InviteSent event={event} links={links} />);

    expect(screen.getByRole('link', { name: /Back to dashboard/ })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.getByRole('link', { name: /streaming step/ })).toHaveAttribute(
      'href',
      `/events/${EVENT_ID}`,
    );
  });

  test('omits the guests row when no count was given', () => {
    render(<InviteSent event={{ ...event, guest_count: null }} links={links} />);

    expect(screen.queryByText(/guests/)).not.toBeInTheDocument();
  });
});
