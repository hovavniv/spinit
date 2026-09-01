import { DiscoBall } from '@/components/brand/DiscoBall';
import { SiteNav } from '@/components/home/SiteNav';
import { Hero } from '@/components/home/Hero';
import { HowItWorks } from '@/components/home/HowItWorks';
import { RecapSection } from '@/components/home/RecapSection';
import { FinalCta } from '@/components/home/FinalCta';
import { SiteFooter } from '@/components/home/SiteFooter';

// The complete set of `reason` strings `errorRedirect` in
// src/app/api/spotify/callback/route.ts can produce, mapped to short, fixed
// copy -- `searchParams.spotify_error` itself is never rendered, only ever
// one of these known strings (or nothing). An unmapped/unknown code renders
// nothing at all (see the `?? null` below), never the literal string
// "undefined".
const SPOTIFY_ERROR_COPY: Record<string, string> = {
  not_allowlisted: "That Spotify account isn't on the app's tester list yet.",
  declined: 'Spotify connection cancelled — nothing was saved.',
  oauth_error: 'Something went wrong connecting to Spotify. Please try again.',
  state_mismatch: 'That connect link expired. Please try again from your event page.',
  missing_cookie: 'That connect link expired. Please try again from your event page.',
  bad_cookie: 'That connect link expired. Please try again from your event page.',
  not_authorized: 'You are not signed in as that partner.',
  event_not_found: 'Connected, but we could not find that event.',
};

interface HomeProps {
  searchParams: Promise<{ spotify_error?: string }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const { spotify_error: spotifyError } = await searchParams;
  const spotifyErrorMessage = spotifyError ? (SPOTIFY_ERROR_COPY[spotifyError] ?? null) : null;

  return (
    <>
      <DiscoBall />
      <SiteNav />
      {spotifyErrorMessage && (
        <div role="alert" data-testid="spotify-error-banner">
          {spotifyErrorMessage}
        </div>
      )}
      <main>
        <Hero />
        <HowItWorks />
        <RecapSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
