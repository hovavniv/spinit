import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Home from './page';

/**
 * `spotify_error` is set by src/app/api/spotify/callback/route.ts's
 * `errorRedirect` on every failure path (see route.ts's docstring for the
 * complete, current list of reason codes) and lands here, on the homepage —
 * this pins that a KNOWN code renders its mapped copy, and that an UNKNOWN
 * code renders nothing at all, never the literal string "undefined".
 */
describe('Home', () => {
  it('renders the mapped copy for a known spotify_error code', async () => {
    render(await Home({ searchParams: Promise.resolve({ spotify_error: 'not_allowlisted' }) }));

    expect(
      screen.getByText("That Spotify account isn't on the app's tester list yet."),
    ).toBeInTheDocument();
  });

  it('renders nothing for an unmapped spotify_error code — not the string "undefined"', async () => {
    render(await Home({ searchParams: Promise.resolve({ spotify_error: 'made_up_code' }) }));

    expect(screen.queryByTestId('spotify-error-banner')).not.toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('undefined');
  });

  it('renders nothing when there is no spotify_error at all', async () => {
    render(await Home({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByTestId('spotify-error-banner')).not.toBeInTheDocument();
  });
});
