'use server';

import { createClient } from '@/lib/supabase/server';
import { setGuestSessionCookie, getGuestSessionId } from '@/lib/guest/session';
import { mapGuestError, type GuestErrorCode } from './guestErrors';
import { guestNameSchema, guestSuggestSchema, guestVoteSchema } from './liveValidation';

/**
 * `'use server'` wrappers around `guest_join`, `guest_suggest` and
 * `guest_vote` (design §4.4). Called directly from Client Components
 * (`JoinForm`, `GuestPicker`, `GuestQueue`) exactly like `startEvent` is --
 * not `<form action>` submissions in the `useFormState` sense -- so each
 * returns a plain discriminated union, not the auth module's
 * `ActionResult`.
 *
 * F3: `suggestAction`/`voteAction` take the join TOKEN, never the session
 * id, and read the session id off the httpOnly cookie server-side --
 * exactly `/join/[token]/search`'s own pattern. Taking `sessionId` as a
 * parameter meant it flowed into `'use client'` component props
 * (`GuestPicker`/`GuestQueue`) and was serialized into the RSC payload,
 * readable by any script on the page -- the opposite of the cookie's own
 * `httpOnly` guarantee, and a live contradiction of this design's own
 * stated principle (a uuid being unguessable is not an authorization
 * control). The cookie is the only place these actions get the id from now.
 */

type GuestActionFailure = { ok: false; code: GuestErrorCode | 'unknown' | 'invalid'; message: string };

export type JoinActionResult = { ok: true; sessionId: string } | GuestActionFailure;

export type SuggestActionResult =
  | { ok: true; suggestionId: string; wasExisting: boolean }
  | GuestActionFailure;

export type VoteActionResult = { ok: true } | GuestActionFailure;

/**
 * Validates and joins. On success, sets the guest session cookie for this
 * token -- the ONLY place that cookie gets written (design §4.5).
 */
export async function joinAction(token: string, displayName: string): Promise<JoinActionResult> {
  const parsedName = guestNameSchema.safeParse(displayName);
  if (!parsedName.success) {
    return { ok: false, code: 'invalid', message: 'Enter a name so the DJ knows who asked.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('guest_join', {
    p_token: token,
    p_display_name: parsedName.data,
  });

  if (error) {
    return { ok: false, ...mapGuestError(error) };
  }

  const sessionId = data as string;
  await setGuestSessionCookie(token, sessionId);

  return { ok: true, sessionId };
}

export async function suggestAction(
  token: string,
  trackId: string,
  title: string,
  artist: string,
): Promise<SuggestActionResult> {
  const parsed = guestSuggestSchema.safeParse({ trackId, title, artist });
  if (!parsed.success) {
    return { ok: false, code: 'invalid', message: "Couldn't add that one." };
  }

  const sessionId = await getGuestSessionId(token);
  if (!sessionId) {
    return { ok: false, ...mapGuestError({ message: 'no_such_session' }) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('guest_suggest', {
    p_session_id: sessionId,
    p_track_id: parsed.data.trackId,
    p_title: parsed.data.title,
    p_artist: parsed.data.artist,
  });

  if (error) {
    return { ok: false, ...mapGuestError(error) };
  }

  const row = (data as { suggestion_id: string; was_existing: boolean }[] | null)?.[0];
  if (!row) {
    return { ok: false, code: 'unknown', message: "Couldn't add that one." };
  }

  return { ok: true, suggestionId: row.suggestion_id, wasExisting: row.was_existing };
}

export async function voteAction(token: string, suggestionId: string): Promise<VoteActionResult> {
  const parsed = guestVoteSchema.safeParse({ suggestionId });
  if (!parsed.success) {
    return { ok: false, code: 'invalid', message: "Couldn't add that one." };
  }

  const sessionId = await getGuestSessionId(token);
  if (!sessionId) {
    return { ok: false, ...mapGuestError({ message: 'no_such_session' }) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('guest_vote', {
    p_session_id: sessionId,
    p_suggestion_id: parsed.data.suggestionId,
  });

  if (error) {
    return { ok: false, ...mapGuestError(error) };
  }

  return { ok: true };
}
