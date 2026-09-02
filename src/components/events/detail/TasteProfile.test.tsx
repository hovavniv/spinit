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

const noGenres = {};
const noProgress = { settled: 0, total: 0 };

describe('TasteProfile', () => {
  it('renders the outstanding partner by name when only one has a profile', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: profile(['a']) }}
        partner2={{ name: 'Chris', profile: null }}
        genresByArtistId={noGenres}
        progress={noProgress}
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
        genresByArtistId={noGenres}
        progress={noProgress}
      />,
    );
    expect(screen.getByText(/music match/i)).toBeInTheDocument();
    expect(screen.getByText(/shared favou?rites/i)).toBeInTheDocument();
    expect(screen.getByText('Artist b')).toBeInTheDocument();
  });

  it('says "not enough listening history" rather than 0% when noData is set', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: profile([]) }}
        partner2={{ name: 'Chris', profile: profile([]) }}
        genresByArtistId={noGenres}
        progress={noProgress}
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
        genresByArtistId={noGenres}
        progress={noProgress}
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
        genresByArtistId={noGenres}
        progress={noProgress}
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
        genresByArtistId={noGenres}
        progress={noProgress}
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

  // --- Task 9: genre panels ---------------------------------------------

  const genreArtist = (id: string, score: number) =>
    ({ id, name: id, artworkUrl: null, score, ranges: ['medium_term' as const] });
  const genreProfile = (id: string, artists: ReturnType<typeof genreArtist>[]) =>
    ({ partnerId: id, computedAt: '2026-08-31T00:00:00Z', topArtists: artists });

  const p1 = genreProfile('p1', [genreArtist('x', 3)]);
  const p2 = genreProfile('p2', [genreArtist('y', 3)]);

  it('shows "still analysing" while settled < total', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: p1 }}
        partner2={{ name: 'Chris', profile: p2 }}
        genresByArtistId={noGenres}
        progress={{ settled: 4, total: 30 }}
      />,
    );
    expect(screen.getByText(/still analysing/i)).toBeInTheDocument();
    expect(screen.getByText('4 of 30')).toBeInTheDocument();
  });

  it('shows the genre bars once the queue is drained', () => {
    // Deviation from the plan's literal snippet (unscoped screen.getByText):
    // with this fixture (each partner's sole artist carries a DIFFERENT
    // genre), mizrahi/pop are simultaneously the couple's pooled top genres
    // AND asymmetric enough between the two partners to also qualify for
    // avoidGenres -- a real, intended product state (see the avoidGenres
    // doc comment in taste.ts), not a bug. That means BOTH strings render
    // twice on the page (once as a genre-bar, once as an avoid-genre), which
    // makes an unscoped getByText throw "multiple elements found" no matter
    // how correct the implementation is. Scoping to the top-genres panel is
    // what the test actually means to check.
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: p1 }}
        partner2={{ name: 'Chris', profile: p2 }}
        genresByArtistId={{ x: { mizrahi: 100 }, y: { pop: 100 } }}
        progress={{ settled: 30, total: 30 }}
      />,
    );
    const topGenres = screen.getByTestId('top-genres');
    expect(within(topGenres).getByText('mizrahi')).toBeInTheDocument();
    expect(within(topGenres).getByText('pop')).toBeInTheDocument();
  });

  it('renders at most four genre bars', () => {
    const six = genreProfile('p1', [genreArtist('x', 3)]);
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: six }}
        partner2={{ name: 'Chris', profile: p2 }}
        genresByArtistId={{ x: { a: 6, b: 5, c: 4, d: 3, e: 2, f: 1 } }}
        progress={{ settled: 30, total: 30 }}
      />,
    );
    expect(screen.getAllByTestId('genre-bar')).toHaveLength(4);
  });

  it('says so plainly when enrichment finished and found nothing usable', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: p1 }}
        partner2={{ name: 'Chris', profile: p2 }}
        genresByArtistId={noGenres}
        progress={{ settled: 30, total: 30 }}
      />,
    );
    expect(screen.getByText(/couldn.t work out/i)).toBeInTheDocument();
    expect(screen.queryByText(/still analysing/i)).not.toBeInTheDocument();
  });

  it('NEVER shows "still analysing" once settled === total, whatever the outcome', () => {
    for (const genresByArtistId of [noGenres, { x: { pop: 100 } }]) {
      const { unmount } = render(
        <TasteProfile
          partner1={{ name: 'Maya', profile: p1 }}
          partner2={{ name: 'Chris', profile: p2 }}
          genresByArtistId={genresByArtistId}
          progress={{ settled: 30, total: 30 }}
        />,
      );
      expect(screen.queryByText(/still analysing/i)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('shows nothing genre-shaped when total is 0 -- nobody has connected yet', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: p1 }}
        partner2={{ name: 'Chris', profile: p2 }}
        genresByArtistId={noGenres}
        progress={{ settled: 0, total: 0 }}
      />,
    );
    expect(screen.queryByText(/still analysing/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('genre-bar')).not.toBeInTheDocument();
  });

  it('renders avoidGenres as its own panel, distinct from top genres, capped at four', () => {
    render(
      <TasteProfile
        partner1={{ name: 'Maya', profile: genreProfile('p1', [genreArtist('x', 3)]) }}
        partner2={{ name: 'Chris', profile: genreProfile('p2', [genreArtist('y', 3)]) }}
        genresByArtistId={{
          x: { pop: 100, m1: 100, m2: 100, m3: 100, m4: 100, m5: 100 },
          y: { pop: 100 },
        }}
        progress={{ settled: 30, total: 30 }}
      />,
    );
    const avoid = screen.getByTestId('avoid-genres');
    expect(within(avoid).queryByText('pop')).not.toBeInTheDocument(); // both partners have it
    expect(within(avoid).getAllByTestId('avoid-genre')).toHaveLength(4); // six asymmetric, capped
  });
});
