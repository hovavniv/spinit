import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DashboardSidebar } from './DashboardSidebar';
import type { DjProfile } from '@/lib/dashboard/types';

const DJ: DjProfile = { name: 'Jordan Ellis', company: 'Ellis Sound Co.' };

describe('DashboardSidebar', () => {
  test('renders the three DJ nav links when none is current', () => {
    render(<DashboardSidebar dj={DJ} current="none" />);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upcoming events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Past events' })).toBeInTheDocument();
  });

  test('hides the nav entirely for a partner, who has none of those destinations', () => {
    render(<DashboardSidebar dj={DJ} hideNav />);

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Upcoming events' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Past events' })).not.toBeInTheDocument();
  });

  test('still renders the profile chip when the nav is hidden', () => {
    render(<DashboardSidebar dj={DJ} hideNav />);

    expect(screen.getByText('Jordan Ellis')).toBeInTheDocument();
    expect(screen.getByText('Ellis Sound Co.')).toBeInTheDocument();
  });
});
