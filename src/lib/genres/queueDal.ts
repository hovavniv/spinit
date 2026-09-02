import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Data-access layer for `enrichment_queue` -- the work list §2.11 introduced
 * specifically because deriving progress from the merged top-artist list
 * made "analysing" unable to clear (design §2.10). `total`/`settled` are
 * always read from THIS table, never from `taste_profiles.top_artists`.
 */

/** Marks one queue row settled -- called on a TERMINAL outcome only (resolved
 *  or a non-retryable failure), per the route's flow (task 7). */
export async function settle(partnerId: string, artistId: string): Promise<{ rowCount: number }> {
  const supabase = await createClient();

  const write = await supabase
    .from('enrichment_queue')
    .update({ settled_at: new Date().toISOString() })
    .eq('partner_id', partnerId)
    .eq('artist_id', artistId)
    .select();
  if (write.error) {
    throw new Error(`enrichment_queue settle failed: ${write.error.code}`);
  }

  return { rowCount: write.data?.length ?? 0 };
}

/**
 * The inverse of a successful settle -- used on a TRANSIENT (non-terminal)
 * failure, so the row goes back to being claimable rather than settled, but
 * with its backoff state advanced so it is not reclaimed immediately forever.
 *
 * Touches two tables, on purpose:
 *
 *   - `enrichment_queue.claimed_at` -> null, so `claim_next_artist`'s own
 *     `claimed_at is null or claimed_at < now() - interval '2 minutes'`
 *     check (20260901090000_spotify_genre_enrichment.sql) can reclaim it.
 *   - `artist_genres.attempts` / `last_attempt_at` advanced, because THAT is
 *     what `claim_next_artist`'s backoff formula actually reads
 *     (`last_attempt_at < now() - interval '1 minute' * power(2,
 *     least(attempts, 5))`). Clearing `claimed_at` alone would make the row
 *     reclaimable on the very next poll.
 *
 * `artist_genres` is keyed `(event_id, spotify_artist_id)`, and this
 * function's own parameters carry no event id -- it is looked up from
 * `event_partners` first.
 *
 * CONCERN (flagged, not resolved here): `enrichArtist`'s own failure path
 * (enrich.ts) already writes `attempts: 1` unconditionally on every failed
 * attempt via `writeGenres`, rather than incrementing whatever was already
 * there. If a future route (task 7) calls both `writeGenres` (indirectly,
 * inside `enrichArtist`) AND this function for the same failure, the two
 * attempts-tracking writes can disagree -- this function increments the
 * CURRENT stored value, `enrichArtist`'s own write resets it to 1. That
 * inconsistency is not introduced or fixed here; it depends on how task 7
 * (not visible from this task) actually sequences the two calls, and on
 * "fix 9" referenced in the plan, which is also not visible from here.
 *
 * Reports the `enrichment_queue` update's row count -- that is the row this
 * function is nominally "releasing"; the caller has no stated need for a
 * count on the `artist_genres` side-effect.
 */
export async function releaseClaim(partnerId: string, artistId: string): Promise<{ rowCount: number }> {
  const supabase = await createClient();

  const partner = await supabase
    .from('event_partners')
    .select('event_id')
    .eq('id', partnerId)
    .single();
  if (partner.error || !partner.data) {
    throw new Error(`no event_partners row for partner ${partnerId}`);
  }
  const eventId = (partner.data as { event_id: string }).event_id;

  const release = await supabase
    .from('enrichment_queue')
    .update({ claimed_at: null })
    .eq('partner_id', partnerId)
    .eq('artist_id', artistId)
    .select();
  if (release.error) {
    throw new Error(`enrichment_queue release failed: ${release.error.code}`);
  }

  const existing = await supabase
    .from('artist_genres')
    .select('attempts')
    .eq('event_id', eventId)
    .eq('spotify_artist_id', artistId)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`artist_genres attempts read failed: ${existing.error.code}`);
  }
  const currentAttempts = (existing.data as { attempts: number } | null)?.attempts ?? 0;

  const backoff = await supabase
    .from('artist_genres')
    .update({ attempts: currentAttempts + 1, last_attempt_at: new Date().toISOString() })
    .eq('event_id', eventId)
    .eq('spotify_artist_id', artistId)
    .select();
  if (backoff.error) {
    throw new Error(`artist_genres backoff update failed: ${backoff.error.code}`);
  }

  return { rowCount: release.data?.length ?? 0 };
}

/**
 * `count(*)` and `count(*) where settled_at is not null`, both over
 * `enrichment_queue` for that partner -- NOT over `top_artists` (design
 * §2.10 records that counting the artist list instead made "analysing"
 * unable to clear).
 */
export async function queueCounts(partnerId: string): Promise<{ total: number; settled: number }> {
  const supabase = await createClient();

  const total = await supabase
    .from('enrichment_queue')
    .select('*', { count: 'exact', head: true })
    .eq('partner_id', partnerId);
  if (total.error) {
    throw new Error(`enrichment_queue total count failed: ${total.error.code}`);
  }

  const settled = await supabase
    .from('enrichment_queue')
    .select('*', { count: 'exact', head: true })
    .eq('partner_id', partnerId)
    .not('settled_at', 'is', null);
  if (settled.error) {
    throw new Error(`enrichment_queue settled count failed: ${settled.error.code}`);
  }

  return { total: total.count ?? 0, settled: settled.count ?? 0 };
}
