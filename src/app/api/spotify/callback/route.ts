import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { exchangeCode } from '@/lib/spotify/oauth';
import { storeConnection, markConnectionFailed, partnerOwner } from '@/lib/spotify/connectionDal';
import { spotifyFetch, SpotifyError } from '@/lib/spotify/client';
import { syncTasteProfile } from '@/lib/spotify/sync';

/**
 * Spotify redirects here after the couple authorizes (or refuses) the
 * connection request kicked off by `connectSpotify` (Task 6).
 *
 * `partnerId` is taken ONLY from the httpOnly `spotify_oauth` cookie
 * `connectSpotify` set before sending the browser to Spotify -- never from
 * the query string, which is attacker-controlled (an attacker can craft any
 * `partnerId` they like as a query param and get a victim to click it). The
 * cookie also carries `state`, compared against Spotify's echoed-back
 * `state` query param as CSRF protection.
 *
 * The cookie is cleared immediately once it has been read and validated,
 * before any network call -- a one-time-use value that outlives its one use
 * is a bug waiting to happen, not a convenience.
 *
 * The OAuth round trip has unbounded duration -- the session that started it
 * (checked once in `connectSpotify`, Task 6) may have expired by the time
 * Spotify redirects back here. So this route re-checks BOTH identity
 * (`requireUser`) and ownership (`partnerOwner`, shared with Task 6) before
 * doing anything else. Every failure path below -- missing cookie, bad
 * (unparseable) cookie, state mismatch, ownership mismatch, the couple
 * declining consent on Spotify's screen (or any other OAuth error Spotify
 * reports via `?error=`), the `/me` probe 403 (not on the app's allowlist),
 * or the event lookup coming back empty -- returns its own redirect and
 * never reaches the success redirect at the end.
 *
 * A development-mode Spotify app's OAuth handshake succeeds even for a user
 * who is NOT on the app's allowlist -- Spotify only rejects them (403) on the
 * first real API call. So this route probes `GET /me` once, before treating
 * the connection as successful, rather than trusting a clean token exchange
 * alone.
 */

/**
 * `request.url`'s host cannot be trusted to match what the browser actually
 * connected to: this route's dev server sits behind Next 16's internal
 * request proxy, which reports `request.url` using its own internal target
 * host (observed as `localhost`) even when the client's real request came in
 * on a different host (`127.0.0.1`, this project's registered Spotify
 * redirect literal) -- confirmed live, DevTools' own Request URL/Remote
 * Address showed `127.0.0.1:3000` for a request whose Location header this
 * function then built as `localhost:3000`, silently sending the browser to a
 * different origin than the one it was on.
 *
 * The `Host` header is NOT the fix -- it's client-supplied, and building a
 * redirect Location from it is host-header injection on the single most
 * security-sensitive route in this slice (a request carrying `Host: evil.com`
 * would redirect there). The app already knows its own origin as trusted
 * config: the same `SPOTIFY_REDIRECT_URI` the authorize URL and the token
 * exchange use. If the browser reached this callback at all, it arrived at
 * that exact origin -- Spotify only redirects to the registered literal --
 * so there is no case where the request's actual host is right and this is
 * wrong. It's also already validated (oauth.ts throws if it's unset, and
 * Spotify rejects a mismatch at authorize time, loudly, rather than this
 * failing silently at redirect time), and it's what you want behind a
 * production reverse proxy terminating a different hostname than the app's
 * internal target, too.
 */
function originFrom(): string {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!redirectUri) throw new Error('SPOTIFY_REDIRECT_URI is not set');
  return new URL(redirectUri).origin;
}

function errorRedirect(reason: string): Response {
  const url = new URL('/', originFrom());
  url.searchParams.set('spotify_error', reason);
  return NextResponse.redirect(url);
}

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const queryState = query.get('state') ?? '';
  const code = query.get('code') ?? '';
  const oauthError = query.get('error');

  const cookieStore = await cookies();
  const raw = cookieStore.get('spotify_oauth');

  if (!raw) {
    return errorRedirect('missing_cookie');
  }

  let cookiePayload: { state: string; partnerId: string };
  try {
    cookiePayload = JSON.parse(raw.value) as { state: string; partnerId: string };
  } catch {
    cookieStore.delete('spotify_oauth');
    return errorRedirect('bad_cookie');
  }

  if (cookiePayload.state !== queryState) {
    cookieStore.delete('spotify_oauth');
    return errorRedirect('state_mismatch');
  }

  const { partnerId } = cookiePayload;

  // Clear the cookie now -- before the token exchange or any other network
  // call -- on every path past this point, including success.
  cookieStore.delete('spotify_oauth');

  // requireUser() alone only proves someone is signed in -- it says nothing
  // about whether they own THIS partnerId. The session that started this
  // flow may also have expired mid-flow, so this re-checks ownership rather
  // than trusting the cookie's mere presence. On a mismatch, do NOT call
  // storeConnection or any other write.
  const user = await requireUser();
  const ownerId = await partnerOwner(partnerId);
  if (ownerId !== user.id) {
    return errorRedirect('not_authorized');
  }

  // Spotify echoes `state` back on every redirect, including a decline, so
  // this check only runs after the CSRF/state comparison and ownership
  // check above have both passed -- a forged `error` param on an otherwise
  // invalid request is still rejected by those checks first.
  if (oauthError) {
    return errorRedirect(oauthError === 'access_denied' ? 'declined' : 'oauth_error');
  }

  const tokens = await exchangeCode(code);

  let me: { id: string };
  try {
    me = await spotifyFetch<{ id: string }>('/me', tokens.accessToken);
  } catch (error) {
    if (error instanceof SpotifyError && error.kind === 'forbidden') {
      // Application-level reason code only -- never the raw Spotify error text.
      await markConnectionFailed(partnerId, 'not_allowlisted');
      return errorRedirect('not_allowlisted');
    }
    throw error;
  }

  await storeConnection({
    partnerId,
    spotifyUserId: me.id,
    refreshToken: tokens.refreshToken,
  });

  try {
    await syncTasteProfile(partnerId);
  } catch (error) {
    // A connected account with no taste profile yet is recoverable; a
    // callback that 500s after a valid token was already stored is not.
    console.error('spotify taste sync failed after connect', { partnerId, error });
  }

  const supabase = await createClient();
  const { data: partner, error: lookupError } = await supabase
    .from('event_partners')
    .select('event_id')
    .eq('id', partnerId)
    .single();

  if (lookupError || !partner) {
    return errorRedirect('event_not_found');
  }

  const eventId = (partner as { event_id: string }).event_id;
  return NextResponse.redirect(new URL(`/events/${eventId}`, originFrom()));
}
