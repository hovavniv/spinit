'use server';

import 'server-only';

import { requireUser } from '@/lib/auth/dal';
import { exchangeCode } from '@/lib/spotify/oauth';
import { spotifyFetch, SpotifyError } from '@/lib/spotify/client';
import { storeConnection, markConnectionFailed, partnerOwner } from '@/lib/spotify/connectionDal';
import { syncTasteProfile } from '@/lib/spotify/sync';

/**
 * `/dev/paste-code` -- closes the redirect gap for a partner who is NOT on
 * the dev machine (Spotify connect plan, Task 9b). She authorizes on her own
 * device, her browser's `127.0.0.1:3000/api/spotify/callback?code=...` fails
 * because `127.0.0.1` on HER machine is her own loopback, and she pastes the
 * failed URL (or just the bare code) back to the developer over chat.
 *
 * The developer then signs into Spinit AS THAT PARTNER (a test account whose
 * password lives in .env.local, same pattern as TEST_USER_A/B/C/D) and pastes
 * the URL here. This does the same token exchange + store + sync as the real
 * callback route (Task 7), but under that partner's own session, so RLS is
 * satisfied honestly rather than bypassed. This does NOT claim the partner
 * slot -- that is Task 9's flow -- it only closes the redirect gap.
 *
 * The authorization code that crosses the chat is short-lived (~10 minutes),
 * single-use, and scoped to one read-only permission -- but it is still a
 * live credential handoff, so neither this action nor the page it backs may
 * ever log it.
 */

export function codeFrom(pasted: string): string {
  try {
    const code = new URL(pasted).searchParams.get('code');
    if (code) return code;
  } catch {
    // Not a URL -- treat the whole string as a bare code.
  }
  return pasted.trim();
}

export async function pasteCode(formData: FormData): Promise<{ ok: boolean }> {
  // A plain Error, not notFound() -- notFound()'s thrown digest carries no
  // human-readable message, so a caller (or a test) cannot tell a refused
  // production call apart from any other thrown error. The page (which
  // renders, rather than being called directly) still uses notFound().
  if (process.env.NODE_ENV === 'production') {
    throw new Error('/dev/paste-code is not available in production');
  }

  const partnerId = String(formData.get('partnerId'));

  // Same ownership check as connectSpotify/the callback route (Task 6/7):
  // requireUser() alone only proves someone is signed in, not that they own
  // THIS partner row.
  const user = await requireUser();
  const ownerId = await partnerOwner(partnerId);
  if (ownerId !== user.id) {
    throw new Error('you do not own this partner slot');
  }

  const code = codeFrom(String(formData.get('url')));
  const tokens = await exchangeCode(code);

  let me: { id: string };
  try {
    me = await spotifyFetch<{ id: string }>('/me', tokens.accessToken);
  } catch (error) {
    if (error instanceof SpotifyError && error.kind === 'forbidden') {
      // Application-level reason code only -- never the raw Spotify error text.
      await markConnectionFailed(partnerId, 'not_allowlisted');
      return { ok: false };
    }
    throw error;
  }

  await storeConnection({
    partnerId,
    spotifyUserId: me.id,
    refreshToken: tokens.refreshToken,
  });

  // Same shape as the callback (Task 7): a sync failure is recoverable and
  // must not undo an otherwise-successful connect.
  await syncTasteProfile(partnerId).catch(() => undefined);

  return { ok: true };
}
