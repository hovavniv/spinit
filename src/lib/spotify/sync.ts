import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { spotifyFetch } from './client';
import { withUserToken } from './connectionDal';
import { mergeRanges, type ByRange } from './taste';
import type { TimeRange } from './tasteTypes';

const RANGES: TimeRange[] = ['short_term', 'medium_term', 'long_term'];

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
 * `partner_id`, `top_artists`, and `computed_at` -- genre/origin/era weights
 * and `enriched_at` are C2's, once genre enrichment exists. This function
 * must never write `events.couple_status` (that write is a silent no-op
 * under the partner's own session -- see design review) or seed
 * `enrichment_queue` (nothing drains it yet).
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
  });
}
