import 'server-only';

/* ---------------------------------------------------------------------------
   Spotify Authorization Code flow, server-side only.

   Only the client secret and the exchange/refresh calls live here; the
   authorize URL sends the browser to Spotify directly (no secret involved).
   Only one scope is requested -- user-top-read -- because everything this
   feature slice renders comes from /me/top/artists. Asking for more would
   have the couple grant access the app never uses.
   --------------------------------------------------------------------------- */

export const SPOTIFY_SCOPES = ['user-top-read'] as const;

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function authorizeUrl(state: string): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId) throw new Error('SPOTIFY_CLIENT_ID is not set');
  if (!redirectUri) throw new Error('SPOTIFY_REDIRECT_URI is not set');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: SPOTIFY_SCOPES.join(' '),
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id) throw new Error('SPOTIFY_CLIENT_ID is not set');
  if (!secret) throw new Error('SPOTIFY_CLIENT_SECRET is not set');
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function postToken(body: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      // The secret goes in the header, never the body. Bodies end up in logs.
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  });

  // Never leak the raw response body into the thrown error -- Spotify's
  // error bodies can carry detail not meant for a user-facing message.
  if (!res.ok) throw new Error(`spotify token request failed (${res.status})`);

  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!redirectUri) throw new Error('SPOTIFY_REDIRECT_URI is not set');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }).toString();

  const json = await postToken(body);

  if (!json.refresh_token) {
    throw new Error('spotify token exchange did not return a refresh token');
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }).toString();

  const json = await postToken(body);

  return {
    accessToken: json.access_token,
    // Rotation is optional: Spotify's refresh response MAY omit
    // refresh_token, in which case the caller keeps using the old one.
    refreshToken: json.refresh_token ?? refreshToken,
    expiresIn: json.expires_in,
  };
}
