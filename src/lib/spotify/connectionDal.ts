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

  await supabase.from('spotify_connections').upsert(
    {
      partner_id: partnerId,
      spotify_user_id: spotifyUserId,
      status: 'connected',
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'partner_id' },
  );

  await supabase.from('spotify_tokens').upsert(
    {
      partner_id: partnerId,
      refresh_token: encryptToken(refreshToken),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'partner_id' },
  );
}

/**
 * Marks a connection attempt as failed. `reason` is an application-level
 * short code (e.g. 'not_allowlisted') -- the caller is responsible for never
 * passing Spotify's raw error text through here.
 */
export async function markConnectionFailed(partnerId: string, reason: string): Promise<void> {
  const supabase = await createClient();

  await supabase.from('spotify_connections').upsert(
    { partner_id: partnerId, status: 'failed', failure_reason: reason },
    { onConflict: 'partner_id' },
  );
}

export async function disconnect(partnerId: string): Promise<void> {
  const supabase = await createClient();

  // .select() on the delete so a zero-row delete (e.g. another partner's
  // row under RLS) is detectable by a caller, rather than a silent no-op
  // reported as success.
  await supabase.from('spotify_tokens').delete().eq('partner_id', partnerId).select();

  await supabase.from('spotify_connections').upsert(
    { partner_id: partnerId, status: 'invited' },
    { onConflict: 'partner_id' },
  );
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
    await supabase.from('spotify_tokens').upsert(
      {
        partner_id: partnerId,
        refresh_token: encryptToken(newRefreshToken),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'partner_id' },
    );
  }

  return result;
}
