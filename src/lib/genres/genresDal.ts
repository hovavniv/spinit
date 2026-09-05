import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ArtistGenresRow } from './enrich';
import type { FacetedTags } from './types';

/**
 * Data-access layer for `artist_genres` (the per-event genre cache, §5.1) and
 * the read side of `event_blocklist`'s genre entries.
 *
 * No `upsert_artist_genres` RPC and no service-role key here (design §12.7,
 * revision 6) -- the cache is scoped per event now, so a participant writes
 * their own event's rows directly and the worst a bad write can do is give
 * that couple a wrong taste report, not poison a shared global cache.
 */

/**
 * `row` is passed to Supabase UNTOUCHED -- no `{ ...row, genres: row.genres
 * ?? {} }` default-filling. `ArtistGenresRow` (enrich.ts) makes
 * genres/origins/eras/resolved_via/fetched_at optional on purpose: a failed
 * attempt's row must OMIT those keys entirely so the upsert's `on conflict`
 * merge does not overwrite a previously-cached resolved row's real genres
 * with an empty value on a later failed retry. Defaulting them here would
 * silently reintroduce exactly that clobber.
 */
export async function writeGenres(row: ArtistGenresRow): Promise<{ rowCount: number }> {
  const supabase = await createClient();

  const write = await supabase
    .from('artist_genres')
    .upsert(row, { onConflict: 'event_id,spotify_artist_id' })
    .select();
  if (write.error) {
    throw new Error(`artist_genres upsert failed: ${write.error.code}`);
  }

  return { rowCount: write.data?.length ?? 0 };
}

/**
 * Writes ONLY the genre-side columns of `taste_profiles`: `genre_weights`,
 * `origin_weights`, `era_weights` and `enriched_at`. `sync.ts` owns
 * `top_artists` and `computed_at` exclusively -- two writers, one table,
 * disjoint column sets, same single-writer discipline that fixed the
 * `attempts`/`last_attempt_at` collision between `enrich.ts` and
 * `releaseClaim` (queueDal.ts). A write from here that also carried
 * `top_artists` would clobber the artist list with whatever THIS caller
 * happened to hold -- the same class of silent data loss `writeGenres`'s own
 * omitted-keys discipline exists to prevent, one table over.
 *
 * Named `writeGenreWeights`, not the plan's original `writeTasteProfile` --
 * task 6b's file list omitted this function entirely; the rename records
 * that it writes a narrow slice of the row, not the whole profile.
 *
 * PLAIN UPDATE, not upsert -- found live, not in review: `top_artists` is
 * NOT NULL with no default, and Postgres validates NOT NULL on an
 * `INSERT ... ON CONFLICT DO UPDATE`'s candidate row BEFORE conflict
 * resolution, so an upsert carrying only the four genre-side columns fails
 * `23502` even when the row already exists and the conflict would have
 * resolved as an UPDATE. `sync.ts` always creates the row first (this
 * function is only ever called after a successful `enrichArtist` settle,
 * downstream of at least one prior sync), so there is no legitimate
 * "row doesn't exist yet" case for this function to insert against.
 */
export async function writeGenreWeights(
  partnerId: string,
  weights: { genres: Record<string, number>; origins: Record<string, number>; eras: Record<string, number> },
): Promise<{ rowCount: number }> {
  const supabase = await createClient();

  const write = await supabase
    .from('taste_profiles')
    .update({
      genre_weights: weights.genres,
      origin_weights: weights.origins,
      era_weights: weights.eras,
      enriched_at: new Date().toISOString(),
    })
    .eq('partner_id', partnerId)
    .select();
  if (write.error) {
    throw new Error(`taste_profiles genre-weights update failed: ${write.error.code}`);
  }

  return { rowCount: write.data?.length ?? 0 };
}

export async function readGenres(eventId: string, artistId: string): Promise<FacetedTags | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('artist_genres')
    .select('genres, origins, eras')
    .eq('event_id', eventId)
    .eq('spotify_artist_id', artistId)
    .maybeSingle();
  if (error) {
    throw new Error(`artist_genres read failed: ${error.code}`);
  }
  if (!data) {
    return null;
  }

  const row = data as { genres: Record<string, number>; origins: Record<string, number>; eras: Record<string, number> };
  return { genres: row.genres, origins: row.origins, eras: row.eras };
}

/**
 * One bulk read for the ranking path (design §8.1, live-event slice).
 * `readGenres` above is `.maybeSingle()` -- one artist per call, which would
 * mean one round trip per queue row per poll. This is the read `rankQueue`'s
 * `genresByArtistId` is actually fed from.
 *
 * `status = 'resolved'` only: a `'pending'` or `'failed'` row has no genre
 * data worth matching on, and including it would mean treating an unfetched
 * or permanently-unresolvable artist as "no genres" (silently wrong) rather
 * than "not yet known" (what `rankQueue`'s `genre-pending` reason exists to
 * say instead, one layer up).
 */
export async function readGenresForEvent(
  eventId: string,
): Promise<Record<string, Record<string, number>>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('artist_genres')
    .select('spotify_artist_id, genres')
    .eq('event_id', eventId)
    .eq('status', 'resolved');
  if (error) {
    throw new Error(`artist_genres bulk read failed: ${error.code}`);
  }

  const result: Record<string, Record<string, number>> = {};
  for (const row of (data ?? []) as { spotify_artist_id: string; genres: Record<string, number> }[]) {
    result[row.spotify_artist_id] = row.genres;
  }
  return result;
}

/**
 * Genre entries only. `event_blocklist` holds `'artist'`, `'song'` and
 * `'genre'` rows in one `value` column -- reading raw values would ban a
 * genre by coincidence of name whenever a couple blocked an ARTIST or SONG
 * that happens to share that name (e.g. the artist "Disco"). The explicit
 * blocklist enforces artist/song entries elsewhere; this is genre-only.
 */
export async function blockedGenres(eventId: string): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('event_blocklist')
    .select('value')
    .eq('event_id', eventId)
    .eq('entry_type', 'genre');
  if (error) {
    throw new Error(`event_blocklist read failed: ${error.code}`);
  }

  return (data ?? []).map((row) => (row as { value: string }).value);
}
