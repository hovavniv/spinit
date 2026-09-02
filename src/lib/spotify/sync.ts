import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { existingArtistIds, insertQueueRows, settleMany } from '@/lib/genres/queueDal';
import { spotifyFetch } from './client';
import { withUserToken } from './connectionDal';
import { mergeRanges, type ByRange } from './taste';
import type { TimeRange } from './tasteTypes';

const RANGES: TimeRange[] = ['short_term', 'medium_term', 'long_term'];

/**
 * design §2.11 line 810: "sync.ts writes it in phase 1 -- the top 20 by
 * artistScore." Without this cap, sync.ts seeded ALL of a partner's merged
 * top-artist list (up to ~150, three ranges at up to 50 each) into
 * enrichment_queue -- at the ladder's 2s MusicBrainz pacing, 5+ minutes and
 * 300+ outbound calls per partner against two free, rate-limited APIs, for a
 * report that renders four genre bars.
 */
const QUEUE_DEPTH = 20;

interface SpotifyArtist {
  id: string;
  name: string;
  images: { url: string }[];
}

interface TopArtistsResponse {
  items: SpotifyArtist[];
}

/**
 * Phase-1 sync: fetches the partner's Spotify top artists across all three
 * time ranges, merges them into one ranked list (task 4's `mergeRanges`),
 * and stores that list on `taste_profiles`. Deliberately writes ONLY
 * `partner_id`, `top_artists`, and `computed_at` on `taste_profiles` --
 * genre/origin/era weights and `enriched_at` are C2's, once genre
 * enrichment exists. This function must never write `events.couple_status`
 * (that write is a silent no-op under the partner's own session -- see
 * design review).
 *
 * It DOES reconcile `enrichment_queue` (task 7b) against the same merged
 * list, in one pass against one read of the existing queue: insert a new row
 * (with `position` = that artist's index in the score-ordered list) for
 * every fresh-list artist not already queued, and settle every existing
 * queue row whose artist dropped off the fresh list. Never touches a row
 * that is already present -- settled or not -- so a re-sync can never
 * un-settle completed enrichment work, and an existing row's `position`
 * never changes once written. Without this write, `claim_next_artist`
 * (task 2d) has nothing to claim, ever.
 *
 * PRECONDITION: the caller has verified that the signed-in user owns
 * `partnerId` (requireUser + partnerOwner), as connectSpotify, resyncSpotify
 * and the callback route all do. This function does not re-check.
 */
export async function syncTasteProfile(partnerId: string): Promise<void> {
  await withUserToken(partnerId, async (accessToken) => {
    const byRange = {} as ByRange;

    for (const range of RANGES) {
      const res = await spotifyFetch<TopArtistsResponse>(
        `/me/top/artists?time_range=${range}&limit=50`,
        accessToken,
      );
      byRange[range] = res.items.map((artist) => ({
        id: artist.id,
        name: artist.name,
        artworkUrl: artist.images[0]?.url ?? null,
      }));
    }

    const topArtists = mergeRanges(byRange);

    const supabase = await createClient();
    const written = await supabase.from('taste_profiles').upsert(
      {
        partner_id: partnerId,
        top_artists: topArtists,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'partner_id' },
    ).select();

    if (written.error) {
      throw new Error(`taste_profiles upsert failed: ${written.error.code} for partner ${partnerId}`);
    }
    if (!written.data?.length) {
      throw new Error(`taste_profiles upsert wrote no row for partner ${partnerId}`);
    }

    // Reconcile enrichment_queue against the SAME merged list, one read of
    // the existing queue, one diff, two writes -- see this function's header
    // comment and the "three rules" recorded there (never un-settle, seed
    // position from rank, never renumber an existing row).
    const existingIds = await existingArtistIds(partnerId);

    // The queue only ever tracks the top QUEUE_DEPTH artists (design §2.11:
    // "the top 20 by artistScore"), computed ONCE and used for BOTH the
    // insert below and the stale diff -- comparing the stale diff against the
    // uncapped `topArtists` instead would leave an artist ranked 21+ that a
    // PRE-cap sync already queued (or an artist that fell out of the top 20
    // between syncs while staying on the full merged list) looking "still
    // fresh" forever, so it would never settle even though the capped queue
    // no longer tracks it.
    const cappedArtists = topArtists.slice(0, QUEUE_DEPTH);
    const freshIds = new Set(cappedArtists.map((a) => a.id));

    const staleIds = [...existingIds].filter((id) => !freshIds.has(id));
    await settleMany(partnerId, staleIds);

    const newRows = cappedArtists
      .map((artist, position) => ({ artistId: artist.id, position }))
      .filter((row) => !existingIds.has(row.artistId));
    await insertQueueRows(partnerId, newRows);
  });
}
