import 'server-only';

/* ---------------------------------------------------------------------------
   The APP token: client credentials, no user, no allowlist (design §2.5).

   This is what makes the product work despite Spotify's five-user cap: that cap
   applies to USER-scoped tokens only, so the two partners who connect are
   constrained and search is not.

   Be precise about what that does NOT yet mean. This route is gated by
   requireUser(), so today it serves signed-in users only -- not the no-login QR
   guests the product is for. The guest flow is a later slice, and when it comes
   the fix is a separate unauthenticated path with its own rate limiting, NOT
   deleting requireUser() from this one.

   Cached in a module-level variable. On Vercel each serverless instance holds
   its own, so several valid app tokens may exist at once. That is expected and
   allowed; no shared cache is built for it.
   --------------------------------------------------------------------------- */

let cached: { token: string; expiresAt: number } | null = null;

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export async function appToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id) throw new Error('SPOTIFY_CLIENT_ID is not set');
  if (!secret) throw new Error('SPOTIFY_CLIENT_SECRET is not set');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      // The secret goes in the header, never the body. Bodies end up in logs.
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`spotify token request failed (${res.status})`);

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

/** Test seam only. */
export function __clearAppTokenCache() {
  cached = null;
}
