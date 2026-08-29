import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DashboardScreen } from './DashboardScreen';
import { demoData } from '@/lib/dashboard/demoData';

describe('DashboardScreen', () => {
  it('renders the greeting, both section headings, both upcoming cards and both past rows from demoData', () => {
    render(<DashboardScreen data={demoData} />);

    expect(screen.getByText('Good evening, Jordan')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Upcoming events' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Past events' })).toBeInTheDocument();
    expect(screen.getByText('Priya & Alex')).toBeInTheDocument();
    expect(screen.getByText('Sam & Jordan R.')).toBeInTheDocument();
    expect(screen.getByText('Noa & Eitan')).toBeInTheDocument();
    expect(screen.getByText('Claire & Ben')).toBeInTheDocument();

    // Finding 7b: pins formatPastDate's full-month-name output against a
    // regression to formatCardDate's abbreviated format.
    expect(screen.getByText('July 18, 2026 · Franklin Hall')).toBeInTheDocument();

    // Finding 7c: pins SectionHeading's aria-label on the "View all" links.
    expect(screen.getByRole('link', { name: 'View all upcoming events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all past events' })).toBeInTheDocument();

    // Finding 7d: pins the "Dashboard" nav item as a non-link current-page marker.
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toHaveAttribute('aria-current', 'page');
  });

  it('renders the live banner when liveEvent is set, and renders no banner when it is null', () => {
    const { unmount } = render(<DashboardScreen data={demoData} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Maya & Tomer')).toBeInTheDocument();
    unmount();

    render(<DashboardScreen data={{ ...demoData, liveEvent: null }} />);
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.queryByText('Maya & Tomer')).not.toBeInTheDocument();
    expect(screen.queryByText('Manage live event →')).not.toBeInTheDocument();
  });

  it('renders the two status pills with their two distinct labels', () => {
    render(<DashboardScreen data={demoData} />);

    expect(screen.getByText('Streaming connected')).toBeInTheDocument();
    expect(screen.getByText('Awaiting couple')).toBeInTheDocument();
  });

  it('points "+ New event" and an upcoming card at the URLs design §7 specifies', () => {
    render(<DashboardScreen data={demoData} />);

    expect(screen.getByRole('link', { name: '+ New event' })).toHaveAttribute(
      'href',
      '/events/new',
    );
    expect(screen.getByRole('link', { name: /Priya & Alex/ })).toHaveAttribute(
      'href',
      '/events/priya-alex',
    );

    // Finding 7e: pins the past-row "View recap →" link's href — there are
    // two past rows, both with "View recap →" links, so getByRole throws on
    // finding two matches; use getAllByRole and check every match instead.
    const recapLinks = screen.getAllByRole('link', { name: /View recap/ });
    expect(recapLinks).toHaveLength(2);
    for (const link of recapLinks) {
      expect(link.getAttribute('href')).toMatch(/^\/events\/.+\/recap$/);
    }
  });

  it('omits the days-until chip for an upcoming event whose date has already passed', () => {
    const pastUpcoming = {
      ...demoData,
      upcoming: [{ ...demoData.upcoming[0], date: '2026-01-01' }],
    };
    render(<DashboardScreen data={pastUpcoming} />);

    // Queries by test id, not text: an omitted chip and a chip rendered
    // empty both produce zero visible text, so only the element's presence
    // actually distinguishes them (see UpcomingEvents.tsx).
    expect(screen.queryByTestId('days-until-chip')).not.toBeInTheDocument();
  });

  describe('empty states', () => {
    const emptyData = {
      dj: { name: 'Jordan Ellis', company: 'Ellis Sound Co.' },
      now: '2026-08-27T20:00',
      liveEvent: null,
      upcoming: [],
      past: [],
    };

    it('tells a DJ with no upcoming events that there are none', () => {
      render(<DashboardScreen data={emptyData} signOutAction={vi.fn()} />);
      expect(screen.getByText('No upcoming events yet.')).toBeInTheDocument();
    });

    it('tells a DJ with no past events that there are none', () => {
      render(<DashboardScreen data={emptyData} signOutAction={vi.fn()} />);
      expect(
        screen.getByText('No past events yet. Once an event wraps, its recap shows up here.'),
      ).toBeInTheDocument();
    });

    it('shows neither empty message once events exist', () => {
      render(<DashboardScreen data={demoData} signOutAction={vi.fn()} />);
      expect(screen.queryByText('No upcoming events yet.')).not.toBeInTheDocument();
      expect(
        screen.queryByText('No past events yet. Once an event wraps, its recap shows up here.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('sign out', () => {
    it('offers a sign-out control when the DJ has events', () => {
      render(<DashboardScreen data={demoData} signOutAction={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    });

    it('offers a sign-out control when the DJ has none', () => {
      render(
        <DashboardScreen
          data={{
            dj: { name: 'Jordan Ellis', company: 'Ellis Sound Co.' },
            now: '2026-08-27T20:00',
            liveEvent: null,
            upcoming: [],
            past: [],
          }}
          signOutAction={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    });

    it('submits the action it was given, not one of its own', async () => {
      const signOutAction = vi.fn();
      const user = userEvent.setup();
      render(<DashboardScreen data={demoData} signOutAction={signOutAction} />);
      await user.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(signOutAction).toHaveBeenCalled();
    });

    it('renders no sign-out control when no action is supplied', () => {
      render(<DashboardScreen data={demoData} />);
      expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    });
  });
});
