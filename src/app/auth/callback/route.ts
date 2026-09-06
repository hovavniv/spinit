import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';

import { createClient } from '@/lib/supabase/server';
import { safeRedirect, postLoginPath, invitePathFromMetadata } from '@/lib/auth/redirects';
import { logAuthError } from '@/lib/auth/errors';
import { siteUrl } from '@/lib/auth/site-url';
import { INVITE_COOKIE } from '@/lib/auth/inviteCookie';

/**
 * design 4.1 / 4.3 step 3, plan task 8. One route handler serves both the
 * Google OAuth flow and Supabase's stock email-confirmation redirect —
 * verified (design 4.1) that both always deliver `?code=...` in the query
 * string, never a URL fragment, so `exchangeCodeForSession(code)` is the
 * correct and only call needed. No disambiguation between the two flows.
 *
 * Fixed internal reason codes carried on the /login redirect — never the
 * remote-supplied `error_description` (secure-coding rule 9). `bad_code_verifier`
 * and `flow_state_not_found` (query-param branch) and `pkce_code_verifier_not_found`
 * (exchange-error branch) get a distinct code from every other failure so a
 * later task can render "open the link in the same browser you used to
 * register" for exactly those two (design gap 10) without wiring that copy
 * here.
 */
const REASON_CONFIRMATION_FAILED = 'confirmation_failed';
const REASON_SAME_BROWSER = 'confirmation_failed_same_browser';

const SAME_BROWSER_ERROR_CODES = new Set([
  'bad_code_verifier',
  'flow_state_not_found',
  'pkce_code_verifier_not_found',
]);

function loginRedirect(reason: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${reason}`, siteUrl()));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorCode = searchParams.get('error_code');

  // GoTrue's PKCE branch attaches error/error_code to the redirect BEFORE
  // the DB lookup that would otherwise fail, so an expired/used/mismatched
  // link arrives here as ordinary query params, not as an exception from
  // exchangeCodeForSession (design 4.1). `error`/`error_code` take
  // precedence over `code` even when both are present together — a buggy
  // or forged redirect sending both must still fail closed.
  if (error || errorCode || !code) {
    logAuthError({ event: 'callback', constraint: errorCode ?? error ?? 'missing_code' });
    const reason = errorCode && SAME_BROWSER_ERROR_CODES.has(errorCode)
      ? REASON_SAME_BROWSER
      : REASON_CONFIRMATION_FAILED;
    return loginRedirect(reason);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    logAuthError({ event: 'callback', constraint: exchangeError.code ?? exchangeError.message });
    const reason = exchangeError.code && SAME_BROWSER_ERROR_CODES.has(exchangeError.code)
      ? REASON_SAME_BROWSER
      : REASON_CONFIRMATION_FAILED;
    return loginRedirect(reason);
  }

  // Read only AFTER the exchange succeeds: consuming an invitation on a failed
  // confirmation would burn it for nothing.
  const cookieStore = await cookies();
  const pending = cookieStore.get(INVITE_COOKIE)?.value ?? null;
  if (pending) cookieStore.delete(INVITE_COOKIE);

  const invitePath = safeRedirect(pending);
  if (pending && invitePath !== '/dashboard') {
    return NextResponse.redirect(new URL(invitePath, siteUrl()));
  }

  // No usable invitation cookie. Fall back to where this user actually
  // belongs, not to the literal /dashboard: a partner landing there is asked
  // for a DJ business name they will never have (design §4.8). Same two
  // parallel existence checks signInWithPassword already runs.
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? '';
  const [ownedEvents, partnerLinks] = await Promise.all([
    supabase.from('events').select('id').eq('dj_id', userId).limit(1),
    supabase.from('event_partners').select('id').eq('user_id', userId).limit(1),
  ]);
  const ownsEvents = (ownedEvents.data?.length ?? 0) > 0;
  const isPartner = (partnerLinks.data?.length ?? 0) > 0;

  // NEITHER a DJ nor an already-claimed partner -- which is exactly what a
  // partner looks like at the moment they confirm, because the claim has not
  // happened yet. Before conceding /dashboard, ask the account itself whether
  // it remembers an invitation (2026-09-06). The cookie's twin, for the case
  // the cookie cannot cover: spinit_invite expires after 30 minutes, while the
  // PKCE verifier cookie lasts the browser session, so a partner who opens
  // their confirmation email an hour later arrives here with a VALID exchange
  // and no invitation. That is the reported bug. (A partner confirming on a
  // DIFFERENT device never reaches this line at all -- the exchange above
  // fails first, because the PKCE verifier is also a cookie. Their next
  // password login is what rescues them, in signInWithPassword.)
  //
  // Ordered AFTER the two existence checks on purpose. A partner who has
  // already claimed still carries the metadata for ever, and sending them back
  // to a claim page that would now refuse them is worse than /my-event.
  if (!ownsEvents && !isPartner) {
    const remembered = invitePathFromMetadata(userData.user?.user_metadata);
    if (remembered) {
      return NextResponse.redirect(new URL(remembered, siteUrl()));
    }
  }

  return NextResponse.redirect(new URL(postLoginPath({ ownsEvents, isPartner }), siteUrl()));
}
