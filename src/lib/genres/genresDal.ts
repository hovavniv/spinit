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
