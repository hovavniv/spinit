import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { encryptToken, decryptToken } from './crypto';
import { refreshAccessToken } from './oauth';

/**
 * Data-access layer for the couple's Spotify connection state
 * (`spotify_connections`) and their encrypted refresh token
 * (`spotify_tokens`). Split across two tables on purpose: the connection
 * row (status, spotify user id) is safe to select broadly, the token row
 * carries a secret and stays narrowly scoped.
 *
 * The refresh token is encrypted BEFORE it reaches Postgres (see ./crypto) --
 * a database dump alone must not yield a usable Spotify credential.
 */

interface StoreConnectionInput {
  partnerId: string;
  spotifyUserId: string;
  refreshToken: string;
}

export async function storeConnection(
  { partnerId, spotifyUserId, refreshToken }: StoreConnectionInput,
): Promise<void> {
  const supabase = await createClient();

  const conn = await supabase.from('spotify_connections').upsert(
    {
      partner_id: partnerId,
      spotify_user_id: spotifyUserId,
      status: 'connected',
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'partner_id' },
  ).select();
  if (conn.error) {
    throw new Error(`spotify_connections upsert failed: ${conn.error.code}`);
  }
  if (!conn.data?.length) {
    throw new Error(`spotify_connections upsert wrote no row for partner ${partnerId}`);
  }

  // This write carries the refresh token itself -- a silent failure here
  // would report the OAuth flow as successful with no credential stored.
  const tok = await supabase.from('spotify_tokens').upsert(
    {
      partner_id: partnerId,
      refresh_token: encryptToken(refreshToken),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'partner_id' },
  ).select();
  if (tok.error) {
    throw new Error(`spotify_tokens upsert failed: ${tok.error.code}`);
  }
  if (!tok.data?.length) {
    throw new Error(`spotify_tokens upsert wrote no row for partner ${partnerId}`);
  }
}

/**
 * Marks a connection attempt as failed. `reason` is an application-level
 * short code (e.g. 'not_allowlisted') -- the caller is responsible for never
 * passing Spotify's raw error text through here.
 */
export async function markConnectionFailed(partnerId: string, reason: string): Promise<void> {
  const supabase = await createClient();

  const conn = await supabase.from('spotify_connections').upsert(
    { partner_id: partnerId, status: 'failed', last_error: reason },
    { onConflict: 'partner_id' },
  ).select();
  if (conn.error) {
    throw new Error(`spotify_connections upsert failed: ${conn.error.code}`);
  }
  if (!conn.data?.length) {
    throw new Error(`spotify_connections upsert wrote no row for partner ${partnerId}`);
  }
}

/**
 * PRECONDITION: the caller has already established that the signed-in user
 * owns `partnerId`. Like the rest of this file, `disconnect` does not
 * re-check -- `disconnectSpotify` in actions.ts is the authorization
 * boundary.
 *
 * That precondition is what makes the zero-row delete below safe to ignore:
 * with ownership already established, removing no token row can only mean
 * it was already gone (disconnect is idempotent), never that RLS filtered a
 * mismatched caller. A caller that skips the ownership check silently
 * inverts that reading. Add one and you must add the check too.
 */
export async function disconnect(partnerId: string): Promise<void> {
  const supabase = await createClient();

  // .select() on the delete so a real failure (`del.error`) is still
  // detectable. A zero-row delete is NOT treated as a failure here: by the
  // time `disconnect` runs, the caller (disconnectSpotify, Task 7b) has
  // already verified ownership of `partnerId` via `partnerOwner`, so a
  // zero-row delete can only mean "already disconnected" -- deleting an
  // already-absent token is idempotent, not an error. (Contrast with the
  // upsert below: an admitted-zero-rows write there has no benign reading,
  // so it still throws.)
  const del = await supabase.from('spotify_tokens').delete().eq('partner_id', partnerId).select();
  if (del.error) {
    throw new Error(`spotify_tokens delete failed: ${del.error.code}`);
  }

  const conn = await supabase.from('spotify_connections').upsert(
    { partner_id: partnerId, status: 'invited' },
    { onConflict: 'partner_id' },
  ).select();
  if (conn.error) {
    throw new Error(`spotify_connections upsert failed: ${conn.error.code}`);
  }
  if (!conn.data?.length) {
    throw new Error(`spotify_connections upsert wrote no row for partner ${partnerId}`);
  }
}

/**
 * Reads the stored refresh token, refreshes it against Spotify, runs `fn`
 * with the fresh access token, and writes back a rotated refresh token if
 * Spotify issued one. `spotify_tokens.updated_at` has no `moddatetime`
 * trigger, so it is set explicitly on any write that touches the row.
 */
export async function withUserToken<T>(
  partnerId: string,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('spotify_tokens')
    .select('refresh_token')
    .eq('partner_id', partnerId)
    .single();

  if (error || !data) {
    throw new Error(`no stored spotify token for partner ${partnerId}`);
  }

  const storedRefreshToken = decryptToken((data as { refresh_token: string }).refresh_token);
  const { accessToken, refreshToken: newRefreshToken } = await refreshAccessToken(storedRefreshToken);

  const result = await fn(accessToken);

  if (newRefreshToken !== storedRefreshToken) {
    // Spotify has already rotated the token by the time this runs, so the
    // old refresh token is invalid regardless of whether this write lands.
    // A silently-swallowed failure here would leave the stored (now-dead)
    // token permanently unrecoverable without a full reconnect -- throw,
    // do not let the caller's work look like it succeeded.
    const rot = await supabase.from('spotify_tokens').upsert(
      {
        partner_id: partnerId,
        refresh_token: encryptToken(newRefreshToken),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'partner_id' },
    ).select();
    if (rot.error) {
      throw new Error(`spotify_tokens rotation upsert failed: ${rot.error.code}`);
    }
    if (!rot.data?.length) {
      throw new Error(`spotify_tokens rotation upsert wrote no row for partner ${partnerId}`);
    }
  }

  return result;
}

/**
 * Looks up who owns an `event_partners` row -- the same ownership check
 * `connectSpotify` (Task 6) needs before starting the OAuth flow, and the
 * callback route needs again on the way back (Task 7), since the session
 * that started the flow may have expired by the time Spotify redirects
 * back. One implementation, both call sites, so the check can't drift.
 */
export async function partnerOwner(partnerId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('event_partners')
    .select('user_id')
    .eq('id', partnerId)
    .single();

  if (error || !data) {
    return null;
  }

  return (data as { user_id: string }).user_id;
}
