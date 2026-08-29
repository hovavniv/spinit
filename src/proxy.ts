import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/proxy';

/**
 * Layer 1 of 3 (design 3): optimistic only. Refreshes the session cookie on
 * every matched request via `getUser()`, and redirects to `/login` only
 * when the path starts with `/dashboard` and no user is present. This is
 * UX and cookie hygiene, not the real gate — `requireUser()` in
 * `src/lib/auth/dal.ts` (task 6) is that.
 */
export async function proxy(request: NextRequest) {
  const isDashboard = request.nextUrl.pathname.startsWith('/dashboard');

  try {
    const { supabase, supabaseResponse } = createClient(request);

    // `getUser()`, never `getSession()` (design 2.3): this is what
    // actually contacts Supabase's auth server and refreshes the session
    // cookie, rather than trusting whatever the cookie already says.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (isDashboard && !user) {
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }

    // Return the response the cookie adapter built, cookies intact — do
    // NOT copy those cookies onto a freshly constructed NextResponse
    // (design 3, design 6): that desyncs what the browser holds from what
    // the server expects and terminates sessions early.
    return supabaseResponse;
  } catch (error) {
    // Constructing the Supabase client can throw (e.g. missing or
    // malformed env vars), and this matcher covers every non-asset path,
    // including the public homepage. On a path under `/dashboard`, the
    // page's own `requireUser()` call is the real gate regardless of what
    // this layer decided, so it stays protected either way. On every
    // other path, this layer is optimistic and UX-only, so a briefly
    // unenforced optimistic check costs nothing — a broken public
    // homepage because of an auth-adjacent misconfiguration is the worse
    // failure mode. Pass the request through rather than 500ing.
    console.error('proxy: supabase client failed', error);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
