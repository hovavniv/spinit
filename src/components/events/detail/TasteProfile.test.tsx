import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TasteProfile } from './TasteProfile';
import type { TasteProfile as TasteProfileType } from '@/lib/spotify/tasteTypes';

const profile = (ids: string[]): TasteProfileType => ({
  partnerId: 'x',
  computedAt: '2026-08-31T00:00:00Z',
  topArtists: ids.map((id, i) => ({
    id,
    name: `Artist ${id}`,
    artworkUrl: null,
    score: 1 - i * 0.1,
    ranges: [],
  })),
});

describe('TasteProfile', () => {
  it('renders the outstanding partner by name when only one has a profile', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: profile(['a']) }}
        partner2={{ name: 'Chris', profile: null }}
      />,
    );
    expect(screen.getByText(/chris/i)).toBeInTheDocument();
    expect(screen.queryByText(/music match/i)).not.toBeInTheDocument();
  });

  it('renders the artist panels when both have profiles', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: profile(['a', 'b']) }}
        partner2={{ name: 'Chris', profile: profile(['b', 'c']) }}
      />,
    );
    expect(screen.getByText(/music match/i)).toBeInTheDocument();
    expect(screen.getByText(/shared favou?rites/i)).toBeInTheDocument();
    expect(screen.getByText('Artist b')).toBeInTheDocument();
  });

  it('renders NO genre panel at all in C1 — not even a waiting state', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: profile(['a']) }}
        partner2={{ name: 'Chris', profile: profile(['a']) }}
      />,
    );
    expect(screen.queryByText(/top genres/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/steer clear/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/still analysing/i)).not.toBeInTheDocument();
  });

  it('says "not enough listening history" rather than 0% when noData is set', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: profile([]) }}
        partner2={{ name: 'Chris', profile: profile([]) }}
      />,
    );
    expect(screen.getByText(/not enough listening history/i)).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('renders a message naming both partners when neither has connected', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: null }}
        partner2={{ name: 'Chris', profile: null }}
      />,
    );
    expect(screen.getByText(/maya/i)).toBeInTheDocument();
    expect(screen.getByText(/chris/i)).toBeInTheDocument();
    expect(screen.queryByText(/music match/i)).not.toBeInTheDocument();
  });

  it('renders each partner\'s exclusive artists under "<name> also loves"', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: profile(['a', 'b']) }}
        partner2={{ name: 'Chris', profile: profile(['b', 'c']) }}
      />,
    );
    expect(screen.getByText(/maya also loves/i)).toBeInTheDocument();
    expect(screen.getByText(/chris also loves/i)).toBeInTheDocument();
    expect(screen.getByText('Artist a')).toBeInTheDocument();
    expect(screen.getByText('Artist c')).toBeInTheDocument();
  });
});
