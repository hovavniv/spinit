import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient, type CookieOptionsWithName } from '@supabase/ssr';

/**
 * Cookie flags for every auth cookie this app writes. Mandatory, not
 * optional (design 8.5): `@supabase/ssr`'s own default is
 * `httpOnly: false` with `secure` unset, which would produce a
 * non-HttpOnly, non-Secure auth cookie — the exact violation dropping the
 * browser client (design 2.7) was meant to avoid.
 */
const cookieOptions: CookieOptionsWithName = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

/**
 * Supabase client for use in Server Components and Server Actions, backed by
 * `next/headers`'s `cookies()`. Create a new client per request — never
 * share one across requests.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch (error) {
            // `cookies().set()` throws when called during a Server
            // Component render — Next disallows mutating cookies outside a
            // Server Action or Route Handler. That case is harmless: the
            // proxy already refreshes the session on every matched request
            // regardless, so a missed refresh here is covered a moment
            // later. But this same `setAll` path is also how
            // `signUpWithPassword`'s `signUp` call writes the PKCE code
            // verifier, from inside a Server Action, where cookie writes
            // ARE allowed — a thrown failure there is real, not the
            // harmless render case, and an empty catch would eat it
            // silently: `signUp` still succeeds, the DJ still gets a
            // "check your email" state and a real email, and the
            // confirmation link then fails later with
            // `bad_code_verifier` with no server-side trace. A Server
            // Component render cannot set cookies; a Server Action can, so
            // a failure here is real and is logged.
            console.error('supabase server client: setAll failed', error);
          }
        },
      },
    },
  );
}
