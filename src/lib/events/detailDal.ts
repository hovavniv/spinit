import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import type { EventDetail, PartnerRow } from './detailTypes';
import type { TasteProfile } from '@/lib/spotify/tasteTypes';

/**
 * One event the CURRENT verified user PARTICIPATES IN — as its DJ or as a
 * linked partner — with both song lists, both note bodies and the partner
 * rows, or null.
 *
 * Null means BOTH "no such event" and "not yours" — deliberately
 * indistinguishable, so the route cannot be used to test whether an id exists
 * (design §2.5). The page turns either into notFound().
 *
 * One request, not five: the lists, the notes and the partners all come back
 * as embedded resources, so Postgres resolves the joins and the client waits
 * once (design §2.6).
 *
 * The DAL filters by the caller's RELATIONSHIP to the row, not by ownership.
 * Where ownership is the relationship, the filter stays .eq('dj_id', user.id) —
 * getEventRecap and every dashboard read still do. Here the relationship is
 * participation, so the filter is the event id and RLS remains the control
 * (design §6.2). Two DALs applying opposite rules for no stated reason is worse
 * than either rule; this is the stated reason.
 *
 * `maybeSingle()`, not `single()`: zero rows is an expected outcome here, not
 * an error worth logging.
 *
 * The embeds are ordered at PostgREST rather than sorted in JavaScript
 * afterwards — that is what makes the (event_id, segment, created_at) indexes
 * earn their tail. `venue` is deliberately not selected: nothing on this page
 * draws it, and selecting a column no component reads is the over-fetch this
 * design argues against.
 */
export const getEventDetail = cache(async (eventId: string): Promise<EventDetail | null> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .select(
      `id, dj_id, couple_names, couple_status,
       event_partners (id, slot, display_name, user_id,
         spotify_connections (status),
         taste_profiles (top_artists, computed_at)),
       event_private_notes (body),
       event_shared_notes (body),
       event_must_play (id, segment, title, artist, moment, spotify_track_id, spotify_artist_id, created_at),
       event_blocklist (id, segment, entry_type, value, spotify_id, created_at)`,
    )
    .eq('id', eventId)
    .order('slot', { referencedTable: 'event_partners', ascending: true })
    .order('created_at', { referencedTable: 'event_must_play', ascending: true })
    .order('id', { referencedTable: 'event_must_play', ascending: true })
    .order('created_at', { referencedTable: 'event_blocklist', ascending: true })
    .order('id', { referencedTable: 'event_blocklist', ascending: true })
    .maybeSingle();

  if (error) {
    console.error('getEventDetail: failed to load event', {
      userId: user.id,
      eventId,
      message: error.message,
    });
    return null;
  }

  if (!data) return null;

  // artist_genres is its own query, not an embed on `events`: it is keyed
  // (event_id, spotify_artist_id) with no foreign key to events, so
  // PostgREST has no relationship to traverse (design §5.1, plan task 8b).
  // Select only the two columns the taste panel reads -- `origins` and
  // `eras` are stored but nothing draws them yet, and fetching them here
  // would be over-fetching on the event page's hot path (scale doc).
  const genres = await supabase
    .from('artist_genres')
    .select('spotify_artist_id, genres')
    .eq('event_id', eventId)
    .eq('status', 'resolved');

  // Deliberately NOT the same failure mode as the query above: `{}` and "the
  // query failed" both render as no genre panels, so collapsing them into
  // the same return value would hide a real failure behind an empty-state
  // UI forever. This throws instead of returning null/{} so the page's error
  // boundary sees it, rather than treating a genre-read failure as if the
  // event itself did not exist.
  if (genres.error) {
    throw new Error(`artist_genres read failed: ${genres.error.code}`);
  }

  const genresByArtistId: Record<string, Record<string, number>> = {};
  for (const row of genres.data ?? []) {
    genresByArtistId[row.spotify_artist_id] = row.genres;
  }

  // enrichment_queue counts for BOTH partners, summed into one server-side
  // progress value (fix spec Blocker 1). `useEnrichmentPoll` is partner-only
  // by design (a DJ's `taste_profiles` write would be a silent zero-row
  // no-op under RLS), so the DJ never gets a successful poll and, before this
  // read existed, `progress` stayed `{0, 0}` forever for that viewer --
  // `TasteProfile`'s `total === 0` branch then reads as "nobody has connected
  // yet" even when both partners are fully enriched. RLS admits the DJ to
  // `enrichment_queue` the same way it admits them to `artist_genres` above,
  // so this read (unlike the poll route) works for every viewer this page
  // admits.
  const partnerIds = (data.event_partners ?? []).map((p) => (p as { id: string }).id);
  const queue =
    partnerIds.length > 0
      ? await supabase.from('enrichment_queue').select('partner_id, settled_at').in('partner_id', partnerIds)
      : { data: [] as { partner_id: string; settled_at: string | null }[], error: null };

  if (queue.error) {
    throw new Error(`enrichment_queue read failed: ${queue.error.code}`);
  }

  let settled = 0;
  let total = 0;
  for (const row of queue.data ?? []) {
    total += 1;
    if ((row as { settled_at: string | null }).settled_at !== null) settled += 1;
  }

  return {
    id: data.id,
    dj_id: data.dj_id,
    couple_names: data.couple_names,
    couple_status: data.couple_status,
    // Both note tables declare `event_id` as PRIMARY KEY and FOREIGN KEY,
    // which is PostgREST's documented condition for detecting a one-to-one
    // relationship: a to-one embed comes back as an OBJECT (`{ body }`), not
    // an array (`[{ body }]`). event_partners' FK is not unique, so it stays
    // to-many and is read as an array below, unchanged.
    //
    // A DJ's read returns the private row; a partner's returns EMPTY
    // (null/undefined), because the policy filters it. That is the boundary
    // working, not an error — do not log it and do not treat it as a failed
    // load. firstRow() normalises either shape so this holds even if the
    // real embed shape (unverifiable until the migration lands) turns out to
    // differ from what's expected here.
    privateNotes: firstRow(data.event_private_notes)?.body ?? '',
    sharedNotes: firstRow(data.event_shared_notes)?.body ?? '',
    partners: (data.event_partners ?? []).map(mapPartnerRow),
    mustPlay: data.event_must_play ?? [],
    blocklist: data.event_blocklist ?? [],
    genresByArtistId,
    enrichmentProgress: { settled, total },
  };
});

/**
 * spotify_connections and taste_profiles are both to-ONE embeds on
 * event_partners: spotify_connections_partner_id_key is a UNIQUE constraint
 * on partner_id, and taste_profiles.partner_id is its PRIMARY KEY -- the same
 * PostgREST one-to-one detection condition the note embeds rely on, so both
 * arrive as OBJECTS, not arrays. firstRow() normalises either shape so this
 * holds even if the real shape differs from what's expected here.
 *
 * top_artists (snake_case jsonb column) is mapped to topArtists (camelCase)
 * HERE and nowhere else -- tasteTypes.ts documents the DAL as the one place
 * this translation happens.
 */
function mapPartnerRow(raw: {
  id: string;
  slot: 1 | 2;
  display_name: string;
  user_id: string | null;
  spotify_connections?: { status: 'invited' | 'connected' | 'failed' } | { status: 'invited' | 'connected' | 'failed' }[] | null;
  taste_profiles?: { top_artists: TasteProfile['topArtists']; computed_at: string } | { top_artists: TasteProfile['topArtists']; computed_at: string }[] | null;
}): PartnerRow {
  const connection = firstRow(raw.spotify_connections);
  const profile = firstRow(raw.taste_profiles);

  return {
    id: raw.id,
    slot: raw.slot,
    display_name: raw.display_name,
    user_id: raw.user_id,
    connection: connection ? { status: connection.status } : null,
    profile: profile
      ? { partnerId: raw.id, topArtists: profile.top_artists, computedAt: profile.computed_at }
      : null,
  };
}

/**
 * PostgREST returns a to-MANY embed as an array and a to-ONE embed as an
 * OBJECT. Both note tables declare `event_id` as primary key AND foreign key,
 * which is PostgREST's one-to-one detection condition, so they come back as
 * `{ body }` rather than `[{ body }]`.
 *
 * Reading a to-one embed as an array yields undefined, which defaults to ''.
 * The note then renders blank and the next save upserts that blank over the
 * stored text -- a silent destroy, not merely a silent read failure.
 *
 * Normalised rather than indexed so this holds whichever shape comes back.
 * The migration is not pushed yet, so the real shape cannot be observed here.
 */
function firstRow<T>(embed: T | T[] | null | undefined): T | undefined {
  if (embed == null) return undefined;
  return Array.isArray(embed) ? embed[0] : embed;
}
