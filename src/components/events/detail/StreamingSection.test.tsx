import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/spotify/actions', () => ({
  connectSpotify: vi.fn(),
  resyncSpotify: vi.fn(),
  disconnectSpotify: vi.fn(),
}));

import { StreamingSection } from './StreamingSection';
import type { PartnerRow } from '@/lib/events/detailTypes';

const partners: PartnerRow[] = [
  { id: 'p1', slot: 1, display_name: 'Maya', user_id: 'user-maya', connection: null, profile: null },
  { id: 'p2', slot: 2, display_name: 'Chris', user_id: 'user-chris', connection: null, profile: null },
];

const connections = {
  p1: { status: 'connected' as const },
  p2: null,
};

describe('StreamingSection', () => {
  it("none of this component's own forms nests inside another of its own forms", () => {
    const { container } = render(
      <StreamingSection
        partners={partners}
        connections={connections}
        viewer={{ role: 'partner', partnerId: 'p1' }}
      />,
    );
    for (const form of container.querySelectorAll('form')) {
      expect(form.parentElement?.closest('form') ?? null).toBeNull();
    }
  });

  it("shows Connect on the viewing partner's own row and on no other", () => {
    render(
      <StreamingSection
        partners={partners}
        connections={{ p1: null, p2: null }}
        viewer={{ role: 'partner', partnerId: 'p2' }}
      />,
    );
    const buttons = screen.getAllByRole('button', { name: /connect/i });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/chris/i);
  });

  it('shows the DJ no connect button at all', () => {
    render(
      <StreamingSection
        partners={partners}
        connections={{ p1: null, p2: null }}
        viewer={{ role: 'dj' }}
      />,
    );
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });

  it("renders Couldn't connect with Try again for a failed connection", () => {
    render(
      <StreamingSection
        partners={partners}
        connections={{ p1: { status: 'failed' }, p2: null }}
        viewer={{ role: 'partner', partnerId: 'p1' }}
      />,
    );
    expect(screen.getByText(/couldn.t connect/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('offers Re-sync on a connected row, and its copy does not promise fresh listening', () => {
    render(
      <StreamingSection
        partners={partners}
        connections={connections}
        viewer={{ role: 'partner', partnerId: 'p1' }}
      />,
    );
    const label = screen.getByRole('button', { name: /re-?sync/i }).textContent ?? '';
    expect(label).not.toMatch(/latest|recent|new listening/i);
  });
});
