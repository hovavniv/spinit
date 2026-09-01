'use server';

import { randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth/dal';
import { authorizeUrl } from './oauth';
import { disconnect, partnerOwner } from './connectionDal';
import { syncTasteProfile } from './sync';

/**
 * Kicks off the Spotify Authorization Code flow for one partner
 * (docs — Spotify connect design, Task 6).
 *
 * The `state` value has to survive the round trip to Spotify and back, but
 * Spotify's callback echoes back only `code` and `state` — no room for a
 * second, app-chosen value like `partnerId`. So `partnerId` rides alongside
 * `state` in a short-lived, httpOnly cookie instead of the query string; the
 * callback (a later task) reads the cookie, never trusts a query param, to
 * recover which partner this connection belongs to.
 *
 * Ownership is checked here, not deferred to RLS alone: `partnerOwner`
 * (connectionDal.ts) looks up the `event_partners` row's `user_id` and it is
 * compared to the caller's — the same defense-in-depth shape `dashboard/dal.ts`
 * and `partnerEventsDal.ts` apply elsewhere in this codebase (see CLAUDE.md /
 * detailActions.ts conventions). A caller who is not that partner is refused
 * before any cookie is set and before Spotify is ever involved.
 *
 * The callback route (Task 7) uses the same `partnerOwner` helper to repeat
 * this check on the way back -- the OAuth round trip has unbounded duration,
 * so the session that passes this check here may no longer be valid by the
 * time Spotify redirects back.
 */
export async function connectSpotify(formData: FormData): Promise<void> {
  const user = await requireUser();

  const partnerId = String(formData.get('partnerId') ?? '');

  const ownerId = await partnerOwner(partnerId);

  if (ownerId !== user.id) {
    throw new Error('Not authorized to connect this partner to Spotify.');
  }

  const state = randomUUID();

  const cookieStore = await cookies();
  cookieStore.set('spotify_oauth', JSON.stringify({ state, partnerId }), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });

  redirect(authorizeUrl(state));
}

/**
 * Re-runs the taste-profile sync (sync.ts, Task 8) for an already-connected
 * partner. Same defense-in-depth ownership check as `connectSpotify`: a
 * `partnerId` arriving in a form is caller-supplied and must never be
 * trusted alone.
 */
export async function resyncSpotify(formData: FormData): Promise<void> {
  const user = await requireUser();

  const partnerId = String(formData.get('partnerId') ?? '');

  const ownerId = await partnerOwner(partnerId);

  if (ownerId !== user.id) {
    throw new Error('Not authorized to resync this partner with Spotify.');
  }

  await syncTasteProfile(partnerId);
}

/**
 * Disconnects a partner's Spotify account: deletes the stored refresh token
 * and returns the connection to `invited` (connectionDal.ts's `disconnect`).
 * Same ownership check as `connectSpotify` -- and ownership is checked HERE,
 * before `disconnect` runs, which is exactly what lets `disconnect` treat a
 * zero-row token delete as idempotent success (already disconnected) rather
 * than an error: the ambiguity a bare zero-row delete would otherwise carry
 * (RLS-filtered vs. genuinely nothing there) is already resolved by this
 * ownership check by the time `disconnect` sees it. A real DB failure inside
 * `disconnect` is not caught here -- it propagates, same as `connectSpotify`.
 */
export async function disconnectSpotify(formData: FormData): Promise<{ ok: boolean }> {
  const user = await requireUser();

  const partnerId = String(formData.get('partnerId') ?? '');

  const ownerId = await partnerOwner(partnerId);

  if (ownerId !== user.id) {
    throw new Error('Not authorized to disconnect this partner from Spotify.');
  }

  await disconnect(partnerId);
  return { ok: true };
}
