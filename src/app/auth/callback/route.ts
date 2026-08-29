import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { safeRedirect } from '@/lib/auth/redirects';
import { logAuthError } from '@/lib/auth/errors';

/**
 * design 4.1 / 4.3 step 3, plan task 8. One route handler serves both the
 * Google OAuth flow and Supabase's stock email-confirmation redirect —
 * verified (design 4.1) that both always deliver `?code=...` in the query
 * string, never a URL fragment, so `exchangeCodeForSession(code)` is the
 * correct and only call needed. No disambiguation between the two flows.
 *
 * Fixed internal reason codes carried on the /login redirect — never the
 * remote-supplied `error_description` (secure-coding rule 9). `bad_code_verifier`
 * and `flow_state_not_found` get a distinct code from every other failure so a
 * later task can render "open the link in the same browser you used to
 * register" for exactly those two (design gap 10) without wiring that copy
 * here.
 */
const REASON_CONFIRMATION_FAILED = 'confirmation_failed';
const REASON_SAME_BROWSER = 'confirmation_failed_same_browser';

const SAME_BROWSER_ERROR_CODES = new Set(['bad_code_verifier', 'flow_state_not_found']);

/**
 * `SITE_URL`, never `request.nextUrl.origin` — the origin is derived from
 * the `Host`/`X-Forwarded-Host` request headers, and design 4.3 states the
 * origin must come only from `SITE_URL`, never a request header (the same
 * rule `actions.ts`'s `siteUrl()` already follows). Not directly
 * browser-exploitable on its own, but matters behind a reverse
 * proxy/CDN misconfiguration, and this route should follow the same
 * control as the rest of the auth flow.
 */
function siteUrl(): string {
  const url = process.env.SITE_URL;
  if (!url) {
    throw new Error('SITE_URL is not set');
  }
  return url;
}

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
    return loginRedirect(REASON_CONFIRMATION_FAILED);
  }

  const next = searchParams.get('next');
  return NextResponse.redirect(new URL(safeRedirect(next), siteUrl()));
}
