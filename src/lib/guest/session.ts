import { cookies } from 'next/headers';

/**
 * The guest session cookie (design §4.5). Keyed by the TOKEN from the
 * guest's own URL, not the event id -- `anon` holds no grant on
 * `public.events`, so a picker page has no other way to learn the event id,
 * and keying on the token also makes the cookie name resolvable by both
 * `/join/[token]` pages and `/join/[token]/search` without a database read.
 *
 * `path: '/join'` is deliberate, not the site-wide default: a bearer token
 * that rides on every request to every route is capability spread wider
 * than the one place that needs it. `/join/[token]/search` lives under
 * `/join` specifically so this cookie reaches it (§4.7).
 *
 * Callers MUST validate the `[token]` route param against `TOKEN_PATTERN`
 * before calling any function here -- these do not re-validate, by design,
 * so that validation happens exactly once, at the point the param first
 * enters the app (design §4.5's reject-before-use discipline).
 */

const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

function cookieName(token: string): string {
  return `spinit_guest_${token}`;
}

/** Called from a Server Action after `guest_join` succeeds. */
export async function setGuestSessionCookie(token: string, sessionId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(cookieName(token), sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/join',
    maxAge: TWELVE_HOURS_SECONDS,
  });
}

/** Reads the session id for this token, or null if the guest has not joined (or the cookie expired). */
export async function getGuestSessionId(token: string): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(cookieName(token))?.value ?? null;
}

/**
 * Called on `no_such_session` (design §8.4) -- a stale or cleared cookie, or
 * an id belonging to a session from a different, already-cleared event.
 */
export async function clearGuestSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({
    name: cookieName(token),
    path: '/join',
  });
}
