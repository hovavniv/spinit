import 'server-only';

export type SpotifyErrorKind = 'rate_limited' | 'forbidden' | 'unauthorized' | 'unavailable';

export class SpotifyError extends Error {
  constructor(
    readonly kind: SpotifyErrorKind,
    readonly status: number,
    readonly endpoint: string,
  ) {
    // The message carries the KIND and the STATUS, never the response body.
    // Spotify's error bodies are not secret, but a body that reaches a client
    // string is one refactor away from a body that reaches a user.
    super(`spotify ${kind} (${status}) on ${endpoint}`);
    this.name = 'SpotifyError';
  }
}

const BASE = 'https://api.spotify.com/v1';

/**
 * One retry on 429, honouring Retry-After, then a typed error.
 *
 * The rate limit is measured PER APP in a rolling 30-second window on
 * development mode's lower tier -- shared across every event in the project.
 * So a 429 is a normal operating condition, not an exception, and the caller
 * renders it as "busy, try again" rather than crashing.
 */
export async function spotifyFetch<T>(
  endpoint: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE}${endpoint}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (res.ok) return (await res.json()) as T;

    if (res.status === 429 && attempt === 0) {
      const wait = Number(res.headers.get('Retry-After') ?? '1');
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000));
      continue;
    }

    throw new SpotifyError(
      res.status === 429 ? 'rate_limited'
        : res.status === 403 ? 'forbidden'
        : res.status === 401 ? 'unauthorized'
        : 'unavailable',
      res.status,
      endpoint,
    );
  }
  throw new SpotifyError('rate_limited', 429, endpoint);
}
