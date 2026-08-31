import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/dal';
import { spotifySearchSchema } from '@/lib/validation';
import { searchTracks, searchArtists } from '@/lib/spotify/search';
import { SpotifyError } from '@/lib/spotify/client';

/**
 * GET, not a server action: server actions are POST-only and uncacheable, and
 * this is a read.
 *
 * requireUser() is load-bearing but NOT sufficient, and the security doc says
 * so: signup is open, so the gate turns "anyone can hammer this proxy" into
 * "anyone willing to register can". The rate limit it would burn is shared by
 * every event in the project. A per-user limiter is not built.
 */
export async function GET(request: Request) {
  await requireUser();

  const params = new URL(request.url).searchParams;
  const parsed = spotifySearchSchema.safeParse({
    q: params.get('q') ?? '',
    type: params.get('type') ?? 'track',
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_query' }, { status: 400 });
  }

  try {
    const results = parsed.data.type === 'track'
      ? await searchTracks(parsed.data.q)
      : await searchArtists(parsed.data.q);
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof SpotifyError && error.kind === 'rate_limited') {
      return NextResponse.json({ error: 'busy' }, { status: 429 });
    }
    console.error('spotify search failed', {
      kind: error instanceof SpotifyError ? error.kind : 'unknown',
    });
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
}
