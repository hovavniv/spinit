'use server';

import { randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { authorizeUrl } from './oauth';

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
 * Ownership is checked here, not deferred to RLS alone: `event_partners` is
 * selected by id and its `user_id` compared to the caller's — the same
 * defense-in-depth shape `dashboard/dal.ts` and `partnerEventsDal.ts` apply
 * elsewhere in this codebase (see CLAUDE.md / detailActions.ts conventions).
 * A caller who is not that partner is refused before any cookie is set and
 * before Spotify is ever involved.
 */
export async function connectSpotify(formData: FormData): Promise<void> {
  const user = await requireUser();

  const partnerId = String(formData.get('partnerId') ?? '');

  const supabase = await createClient();
  const { data: partner, error } = await supabase
    .from('event_partners')
    .select('user_id')
    .eq('id', partnerId)
    .single();

  if (error || !partner || (partner as { user_id: string }).user_id !== user.id) {
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
