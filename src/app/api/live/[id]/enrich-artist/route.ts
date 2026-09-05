import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/validation';
import { enrichArtist } from '@/lib/genres/enrich';
import { mbidForSpotifyArtist, englishAliasFor } from '@/lib/genres/musicbrainz';
import { topTagsByMbid, topTagsByName } from '@/lib/genres/lastfm';
import { writeGenres } from '@/lib/genres/genresDal';

interface ClaimRow {
  spotify_artist_id: string;
  artist_name: string;
}

/**
 * POST /api/live/[id]/enrich-artist -- enrich ONE unresolved artist per call
 * (design §6.2b, Task 15b). DJ-only; a partner gets 404, not 403, same
 * enumeration-oracle reasoning as the other live routes.
 *
 * No advisory lock: `dj_claim_next_artist` (migration 20260905110000) is the
 * atomic claim, an update...returning that stamps attempts/last_attempt_at
 * as the durable marker -- a lock would already be released before
 * `enrichArtist`'s outbound HTTP calls even start, since this route's calls
 * cannot share one transaction with the RPC (verified, not assumed; see that
 * migration's own comment).
 *
 * The client fires this at most once per poll and ignores the result (§6.2b)
 * -- this route's own response is not load-bearing for the screen; the NEXT
 * poll's `unresolvedArtistIds` is what tells the truth.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });

  const user = await requireUser();
  const supabase = await createClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, dj_id, status')
    .eq('id', id)
    .maybeSingle();

  if (!event || event.dj_id !== user.id) return new Response(null, { status: 404 });
  if (event.status !== 'live') return new Response(null, { status: 404 });

  const { data: claimed, error: claimError } = await supabase.rpc('dj_claim_next_artist', {
    p_event_id: id,
  });
  if (claimError) {
    console.error('dj_claim_next_artist failed', { eventId: id, error: claimError });
    return NextResponse.json({ claimed: false }, { status: 503 });
  }

  const claim = ((claimed as ClaimRow[] | null) ?? [])[0];
  if (!claim) {
    // Nothing due: every referenced artist is either resolved or still
    // inside its own backoff window. Not an error -- a queue with no
    // unresolved artists left is the expected steady state.
    return NextResponse.json({ claimed: false });
  }

  let outcome: Awaited<ReturnType<typeof enrichArtist>>;
  try {
    outcome = await enrichArtist(
      { eventId: id, artistId: claim.spotify_artist_id, name: claim.artist_name },
      { mbidForSpotifyArtist, englishAliasFor, topTagsByMbid, topTagsByName, writeGenres },
    );
  } catch (error) {
    // A throw here is uncaught -- distinct from enrichArtist's own classified
    // {status: 'failed'} outcome, which already wrote a failed row itself.
    // Nothing to release: the claim's stamp already recorded this attempt,
    // and the backoff window (not a lock) is what makes it reclaimable.
    console.error('enrichArtist threw', { eventId: id, artistId: claim.spotify_artist_id, error });
    return NextResponse.json({ claimed: true, status: 'failed' }, { status: 200 });
  }

  return NextResponse.json({ claimed: true, status: outcome.status });
}
