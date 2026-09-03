import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/spotify/actions', () => ({
  connectSpotify: vi.fn(),
  resyncSpotify: vi.fn(),
  disconnectSpotify: vi.fn(),
}));

import { connectSpotify, resyncSpotify } from '@/lib/spotify/actions';
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

  it('renders the joined-but-failed detail line with Try again for a failed connection', () => {
    render(
      <StreamingSection
        partners={partners}
        connections={{ p1: { status: 'failed' }, p2: null }}
        viewer={{ role: 'partner', partnerId: 'p1' }}
      />,
    );
    expect(screen.getByText('Joined — Spotify connection failed')).toBeInTheDocument();
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

  it("wires the Connect form's hidden partnerId to the viewing partner, not left blank", () => {
    // Without this hidden input, the real connectSpotify action would receive
    // no partnerId at all -- partnerOwner('') resolves to null and the
    // server-side ownership check throws. Every real Connect click would
    // fail while this whole test suite stayed green.
    render(
      <StreamingSection
        partners={partners}
        connections={{ p1: null, p2: null }}
        viewer={{ role: 'partner', partnerId: 'p2' }}
      />,
    );
    const form = screen.getByRole('button', { name: /connect/i }).closest('form')!;
    expect(form.querySelector('input[name="partnerId"]')).toHaveValue('p2');
  });

  it('binds the Connect button to connectSpotify and the Re-sync button to resyncSpotify, not swapped', () => {
    // Each row is its own <form action={...}>. If the two action bindings
    // were ever swapped at the component (:70/:85), submitting either form
    // would call the WRONG server action -- a re-sync click firing a fresh
    // OAuth connect flow, or a connect click silently no-op'ing a re-sync on
    // a partner who has never connected. Neither the form-count assertions
    // nor the partnerId test above touch which action a given form submits.
    const { unmount } = render(
      <StreamingSection
        partners={partners}
        connections={{ p1: null, p2: null }}
        viewer={{ role: 'partner', partnerId: 'p2' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    expect(connectSpotify).toHaveBeenCalledTimes(1);
    expect(resyncSpotify).not.toHaveBeenCalled();
    unmount();

    vi.clearAllMocks();

    render(
      <StreamingSection
        partners={partners}
        connections={connections}
        viewer={{ role: 'partner', partnerId: 'p1' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /re-?sync/i }));
    expect(resyncSpotify).toHaveBeenCalledTimes(1);
    expect(connectSpotify).not.toHaveBeenCalled();
  });

  describe('acceptance vs. Spotify-connected (fix spec, live-walk finding 1)', () => {
    const notJoined: PartnerRow = {
      id: 'p1',
      slot: 1,
      display_name: 'Maya',
      user_id: null,
      connection: null,
      profile: null,
    };
    const joined: PartnerRow = {
      id: 'p2',
      slot: 2,
      display_name: 'Chris',
      user_id: 'user-chris',
      connection: null,
      profile: null,
    };

    it('user_id null: "Invitation not opened yet", regardless of any spotify status', () => {
      render(
        <StreamingSection
          partners={[notJoined]}
          connections={{ p1: { status: 'connected' } }}
          viewer={{ role: 'dj' }}
        />,
      );
      expect(screen.getByText('Invitation not opened yet')).toBeInTheDocument();
    });

    it('user_id set, no connection row: "Joined — Spotify not connected" with a Not connected chip', () => {
      render(<StreamingSection partners={[joined]} connections={{}} viewer={{ role: 'dj' }} />);
      expect(screen.getByText('Joined — Spotify not connected')).toBeInTheDocument();
      expect(screen.getByText('Not connected')).toBeInTheDocument();
    });

    it('user_id set, status invited: "Joined — Spotify not connected" with a Not connected chip', () => {
      render(
        <StreamingSection
          partners={[joined]}
          connections={{ p2: { status: 'invited' } }}
          viewer={{ role: 'dj' }}
        />,
      );
      expect(screen.getByText('Joined — Spotify not connected')).toBeInTheDocument();
      expect(screen.getByText('Not connected')).toBeInTheDocument();
    });

    it('user_id set, status connected: "Joined · Spotify connected" with a Connected chip', () => {
      render(
        <StreamingSection
          partners={[joined]}
          connections={{ p2: { status: 'connected' } }}
          viewer={{ role: 'dj' }}
        />,
      );
      expect(screen.getByText('Joined · Spotify connected')).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('user_id set, status failed: "Joined — Spotify connection failed" with a Failed chip', () => {
      render(
        <StreamingSection
          partners={[joined]}
          connections={{ p2: { status: 'failed' } }}
          viewer={{ role: 'dj' }}
        />,
      );
      expect(screen.getByText('Joined — Spotify connection failed')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('a not-yet-joined partner renders no Connect button, for the DJ or for the other partner', () => {
      // `isOwnRow` (viewer.partnerId === partner.id) can only be true for a
      // partner `resolveViewer` matched via `user_id` -- a not-yet-joined
      // partner (user_id null) is never that match in production, so the
      // realistic "any viewer" space here is the DJ and the OTHER partner,
      // not this same row's own id (which resolveViewer can never produce
      // for a null user_id, and which fixtures elsewhere in this codebase
      // deliberately reuse to simulate "own row" for unrelated form-nesting
      // assertions -- see EventDetailScreen.test.tsx).
      render(
        <StreamingSection
          partners={[notJoined, joined]}
          connections={{}}
          viewer={{ role: 'dj' }}
        />,
      );
      expect(screen.queryByRole('button', { name: /connect maya/i })).not.toBeInTheDocument();

      render(
        <StreamingSection
          partners={[notJoined, joined]}
          connections={{}}
          viewer={{ role: 'partner', partnerId: 'p2' }}
        />,
      );
      expect(screen.queryByRole('button', { name: /connect maya/i })).not.toBeInTheDocument();
    });
  });
});
