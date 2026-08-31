import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('scopes each artist to the correct partner\'s "also loves" list, not just present somewhere on the page', () => {
    // The heading and its list are SIBLINGS in TasteProfile.tsx (the <h4> is
    // immediately followed by the <ArtistList>'s rendered element, both
    // direct children of the same wrapping section) -- not a heading nested
    // inside its own panel. An unscoped screen.getByText would still pass if
    // partner1Loves/partner2Loves were swapped, since both lists live in the
    // same document regardless of which name they're rendered under. Scoping
    // to each heading's next sibling is what actually pins WHICH partner's
    // heading a given artist renders under.
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: profile(['a', 'b']) }}
        partner2={{ name: 'Chris', profile: profile(['b', 'c']) }}
      />,
    );

    const mayaHeading = screen.getByRole('heading', { name: /maya also loves/i });
    const mayaList = mayaHeading.nextElementSibling as HTMLElement;
    expect(within(mayaList).getByText('Artist a')).toBeInTheDocument();
    expect(within(mayaList).queryByText('Artist c')).not.toBeInTheDocument();

    const chrisHeading = screen.getByRole('heading', { name: /chris also loves/i });
    const chrisList = chrisHeading.nextElementSibling as HTMLElement;
    expect(within(chrisList).getByText('Artist c')).toBeInTheDocument();
    expect(within(chrisList).queryByText('Artist a')).not.toBeInTheDocument();
  });
});
