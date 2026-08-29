import { createServerClient, type CookieOptionsWithName } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cookie flags for every auth cookie this app writes. Mandatory, not
 * optional (design 8.5) — see `src/lib/supabase/server.ts` for the full
 * reasoning. Kept identical in both places.
 */
const cookieOptions: CookieOptionsWithName = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

/**
 * Supabase client for use inside `src/proxy.ts`, backed by the
 * request/response cookie pair rather than `next/headers`. Returns both the
 * client and the `NextResponse` it writes refreshed cookies onto — callers
 * MUST return that same response object, with its cookies intact, rather
 * than copying its cookies onto a freshly constructed `NextResponse`. This
 * is the most common way this integration breaks (design 3, design 6).
 */
export function createClient(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  return { supabase, supabaseResponse };
}
