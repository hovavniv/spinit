import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { partnerContext } from '@/lib/spotify/connectionDal';
import { settle, releaseClaim, queueCounts } from '@/lib/genres/queueDal';
import { writeGenreWeights } from '@/lib/genres/genresDal';
import { enrichArtist } from '@/lib/genres/enrich';
import { mbidForSpotifyArtist, englishAliasFor } from '@/lib/genres/musicbrainz';
import { topTagsByMbid, topTagsByName } from '@/lib/genres/lastfm';
import { writeGenres } from '@/lib/genres/genresDal';
import { genreWeights } from '@/lib/spotify/taste';
import type { ScoredArtist } from '@/lib/spotify/tasteTypes';

/**
 * A full ladder is up to four outbound calls at 2s pacing plus 503 backoff
 * (design §13), which legitimately exceeds Vercel's 10s default. `after()`
 * is NOT the answer here: it runs inside the same limit and is cancelled on
 * timeout (design §11.1's fix 1).
 */
export const maxDuration = 30;

const bodySchema = z.object({ partnerId: z.string().min(1) });

/**
 * A poll-again hint for the client when `claim_next_artist` returns nothing
 * while the queue still has unsettled work -- the 2d migration's own backoff
 * window is measured in MINUTES (2^attempts), far longer than a client
 * should sleep between polls. This is a client re-poll cadence, not a promise
 * that the artist's own backoff has cleared by then.
 */
const RETRY_AFTER_SECONDS = 5;

interface ClaimRow {
  artist_id: string;
  event_id: string;
}

function queueStatus(counts: { total: number; settled: number }) {
  return { total: counts.total, settled: counts.settled, remaining: counts.total - counts.settled };
}

export async function POST(request: Request): Promise<Response> {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_body' }, { status: 400 });
  }
  const { partnerId } = parsed.data;

  // AUTHORIZE: the caller IS that partner -- identity, not participation. A DJ
  // (or any other participant) who is not this partner would enrich the
  // artist and then write ZERO rows to taste_profiles (owner-write policy),
  // returning 200 with genres that never appear -- failure mode 2, closed
  // here rather than discovered downstream.
  const ctx = await partnerContext(partnerId);
  if (!ctx || ctx.userId !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const eventId = ctx.eventId;

  const supabase = await createClient();

  const { data: claimed, error: claimError } = await supabase.rpc('claim_next_artist', {
    p_partner: partnerId,
  });
  if (claimError) {
    console.error('claim_next_artist failed', { partnerId, error: claimError });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const claim = ((claimed as ClaimRow[] | null) ?? [])[0];

  if (!claim) {
    // An empty result means the queue is drained OR every remaining row is
    // still inside its own backoff window -- claim_next_artist cannot tell
    // the two apart, and neither can we, except by comparing settled/total
    // (design §2.10/§2.11's own note, migration 20260901090000).
    const counts = await queueCounts(partnerId);
    const status = queueStatus(counts);
    if (counts.settled >= counts.total) {
      return NextResponse.json(status, { status: 200 });
    }
    return NextResponse.json({ ...status, retryAfter: RETRY_AFTER_SECONDS }, { status: 200 });
  }

  // The claimed artist's display name lives only on the partner's own
  // taste_profiles.top_artists (ScoredArtist) -- artist_name is NOT NULL on
  // artist_genres, so a claimed id with no matching profile entry must
  // release the claim rather than call enrichArtist with a null/invented
  // name that would 23502 mid-request.
  const { data: profileRow, error: profileError } = await supabase
    .from('taste_profiles')
    .select('top_artists')
    .eq('partner_id', partnerId)
    .single();
  if (profileError) {
    // A genuine read failure, not "no such row" -- same treatment as the
    // other DB-read failures in this route (claimError, genreRowsError),
    // not the release+200 path below reserved for a row that legitimately
    // doesn't contain this artist.
    console.error('taste_profiles read failed', { partnerId, error: profileError });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  if (!profileRow) {
    await releaseClaim(partnerId, claim.artist_id);
    const counts = await queueCounts(partnerId);
    return NextResponse.json(queueStatus(counts), { status: 200 });
  }

  const topArtists = (profileRow as { top_artists: ScoredArtist[] }).top_artists ?? [];
  const artist = topArtists.find((a) => a.id === claim.artist_id);
  if (!artist) {
    await releaseClaim(partnerId, claim.artist_id);
    const counts = await queueCounts(partnerId);
    return NextResponse.json(queueStatus(counts), { status: 200 });
  }

  let outcome: Awaited<ReturnType<typeof enrichArtist>>;
  try {
    outcome = await enrichArtist(
      { eventId, artistId: claim.artist_id, name: artist.name },
      { mbidForSpotifyArtist, englishAliasFor, topTagsByMbid, topTagsByName, writeGenres },
    );
  } catch (error) {
    // A throw here is something uncaught -- a bug, an unexpected dependency
    // failure -- distinct from enrichArtist's own classified `{status:
    // 'failed'}` outcome, but it gets the SAME non-terminal handling: the
    // claim must be released, never left settled, or the row becomes
    // immediately re-claimable forever (last_attempt_at stays null with
    // nothing ever stamping it -- the exact hot-loop releaseClaim's own
    // backoff exists to prevent).
    console.error('enrichArtist threw', { partnerId, artistId: claim.artist_id, error });
    await releaseClaim(partnerId, claim.artist_id);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  if (outcome.status === 'failed') {
    // A transport failure is NOT terminal (design §2.10) -- release, don't
    // settle, so the row is reclaimable (subject to its own backoff) rather
    // than stuck as if it were done.
    await releaseClaim(partnerId, claim.artist_id);
    const counts = await queueCounts(partnerId);
    return NextResponse.json(queueStatus(counts), { status: 200 });
  }

  // outcome.status === 'resolved', including resolvedVia 'none' -- the
  // ladder ran to the end and found nothing usable, which is still a real,
  // terminal answer, unlike a 503.
  const settled = await settle(partnerId, claim.artist_id);
  if (settled.rowCount === 0) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  // Recompute this partner's genre/origin/era weights from their own
  // top_artists plus every resolved artist_genres row for this event, and
  // write only the genre-side columns (writeGenreWeights never touches
  // top_artists/computed_at -- sync.ts owns those).
  const { data: genreRows, error: genreRowsError } = await supabase
    .from('artist_genres')
    .select('spotify_artist_id, genres, origins, eras')
    .eq('event_id', eventId);
  if (genreRowsError) {
    console.error('artist_genres read failed during recompute', { eventId, error: genreRowsError });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const genresByArtistId: Record<string, Record<string, number>> = {};
  const originsByArtistId: Record<string, Record<string, number>> = {};
  const erasByArtistId: Record<string, Record<string, number>> = {};
  for (const row of (genreRows ?? []) as {
    spotify_artist_id: string;
    genres: Record<string, number> | null;
    origins: Record<string, number> | null;
    eras: Record<string, number> | null;
  }[]) {
    if (row.genres) genresByArtistId[row.spotify_artist_id] = row.genres;
    if (row.origins) originsByArtistId[row.spotify_artist_id] = row.origins;
    if (row.eras) erasByArtistId[row.spotify_artist_id] = row.eras;
  }

  // `genreWeights` (taste.ts) is generic over its second argument despite the
  // name -- it only sums whatever Record<string, Record<string, number>> it's
  // handed by artist score, then normalizes. Called three times, once per
  // facet, rather than duplicating that logic for origins/eras.
  const weights = {
    genres: genreWeights(topArtists, genresByArtistId),
    origins: genreWeights(topArtists, originsByArtistId),
    eras: genreWeights(topArtists, erasByArtistId),
  };

  const written = await writeGenreWeights(partnerId, weights);
  if (written.rowCount === 0) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const counts = await queueCounts(partnerId);
  return NextResponse.json(queueStatus(counts), { status: 200 });
}
