import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
  });
});
