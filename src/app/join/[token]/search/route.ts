import { NextResponse } from 'next/server';

import { joinTokenParamSchema } from '@/lib/live/liveValidation';
import { getGuestSessionId } from '@/lib/guest/session';
import { createClient } from '@/lib/supabase/server';
import { spotifySearchSchema } from '@/lib/validation';
import { searchTracks } from '@/lib/spotify/search';
import { SpotifyError } from '@/lib/spotify/client';

/**
 * `GET /join/[token]/search` — the one endpoint open to the internet
 * (design §4.7). Lives under `/join`, not `/api`, so the guest session
 * cookie (path `/join`) actually reaches it.
 *
 * No `requireUser()` — there is no DJ session on a guest route. This
 * authenticates purely via the guest cookie plus `guest_search_allow`,
 * which is the ceiling protecting the shared, cross-tenant Spotify app
 * token (`src/lib/spotify/appToken.ts`) from one session's unlimited
 * searching.
 *
 * Writes NOTHING: an earlier draft had this route upsert every search
 * result into `spotify_tracks`, which is both impossible (this route holds
 * only the anon key) and undesirable (it would let one session drive
 * hundreds of catalogue rows for free). Resolution happens once per
 * unresolved track on the DJ's own poll instead.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!joinTokenParamSchema.safeParse(token).success) {
    return NextResponse.json({ error: 'bad_token' }, { status: 404 });
  }

  const sessionId = await getGuestSessionId(token);
  if (!sessionId) {
    return NextResponse.json({ error: 'no_session' }, { status: 401 });
  }

  // M5: validate `q` BEFORE spending one of the 60 guest_search_allow calls
  // -- a malformed query can never produce a search, so charging the guest's
  // rate limit for it first was pure waste, and cheap for a hostile caller
  // to exploit deliberately.
  const searchParams = new URL(request.url).searchParams;
  const parsed = spotifySearchSchema.safeParse({ q: searchParams.get('q') ?? '', type: 'track' });

  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_query' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: allowed, error: allowError } = await supabase.rpc('guest_search_allow', {
    p_session_id: sessionId,
  });

  if (allowError) {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
  if (!allowed) {
    return NextResponse.json({ error: 'search_limit' }, { status: 429 });
  }

  try {
    const results = await searchTracks(parsed.data.q);
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof SpotifyError && error.kind === 'rate_limited') {
      return NextResponse.json({ error: 'busy' }, { status: 429 });
    }
    console.error('guest search failed', {
      kind: error instanceof SpotifyError ? error.kind : 'unknown',
    });
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
}
