import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { readGenresForEvent } from '@/lib/genres/genresDal';
import type { EventPhase } from '@/lib/dashboard/types';
import type { BlocklistRow, MustPlayRow } from '@/lib/events/detailTypes';
import type { PlayedTrack, QueueSuggestion } from './liveTypes';

/**
 * Everything `rankQueue`'s `RankInput` needs, minus `minutesLeftInPhase` --
 * that is date-math against `phaseStartedAt` and belongs to the caller via
 * `phaseClock.ts` (a pure function), not to an I/O DAL (design §8.1, §8.2).
 *
 * Internal DAL, not a page-level guard: this is called only by an
 * already-authorized route/poll (Task 15's poll route) that has already
 * verified the event exists and belongs to this DJ. There is therefore no
 * "return null for not found" contract here -- a missing row or a database
 * error both throw, because both are genuinely exceptional at this point in
 * the call chain, not an expected outcome the caller needs to branch on.
 */
export interface LiveState {
  event: { id: string; phase: EventPhase; phaseStartedAt: string | null };
  mustPlay: MustPlayRow[];
  blocklist: BlocklistRow[];
  played: PlayedTrack[];
  suggestions: QueueSuggestion[];
  genresByArtistId: Record<string, Record<string, number>>;
}

type EventRow = {
  id: string;
  phase: EventPhase;
  phase_started_at: string | null;
  event_must_play: MustPlayRow[] | null;
  event_blocklist: BlocklistRow[] | null;
  played_songs: { position: number; spotify_track_id: string | null }[] | null;
};

type SuggestionRow = {
  id: string;
  spotify_track_id: string;
  title: string;
  artist: string;
  created_at: string;
  guest_sessions: { display_name: string } | { display_name: string }[] | null;
};

export async function readLiveState(eventId: string): Promise<LiveState> {
  const supabase = await createClient();

  // Read 1: event + must-play + blocklist + played_songs, one embedded
  // select. created_at+id is the tiebreaker on BOTH embedded lists -- see the
  // module comment on why created_at alone is not a guarantee. played_songs
  // needs no tiebreaker: (event_id, position) is unique, so it can never tie.
  const eventRead = await supabase
    .from('events')
    .select(
      `id, phase, phase_started_at,
       event_must_play (id, segment, title, artist, moment, spotify_track_id, spotify_artist_id, created_at),
       event_blocklist (id, segment, entry_type, value, spotify_id, created_at),
       played_songs (position, spotify_track_id)`,
    )
    .eq('id', eventId)
    .order('created_at', { referencedTable: 'event_must_play', ascending: true })
    .order('id', { referencedTable: 'event_must_play', ascending: true })
    .order('created_at', { referencedTable: 'event_blocklist', ascending: true })
    .order('id', { referencedTable: 'event_blocklist', ascending: true })
    .order('position', { referencedTable: 'played_songs', ascending: true })
    .maybeSingle();

  if (eventRead.error) {
    throw new Error(`readLiveState: events read failed: ${eventRead.error.code}`);
  }
  if (!eventRead.data) {
    throw new Error(`readLiveState: event ${eventId} not found`);
  }

  const event = eventRead.data as EventRow;

  // Read 2: pending suggestions, same created_at+id tiebreaker.
  //
  // guest_sessions is named explicitly by FK constraint, not just by table
  // name: song_suggestions has TWO paths to guest_sessions once
  // suggestion_votes exists -- the direct `suggested_by` FK, and an
  // implicit many-to-many through suggestion_votes (which itself FKs to
  // both tables). PostgREST reports this ambiguity (PGRST201) against real
  // data regardless of row count; it is a schema-shape issue, not something
  // any mocked test or the throwaway-Postgres harness surfaces, since
  // neither replays PostgREST's own schema cache. Found running the guest
  // seed checkpoint walk against the live project (Task 19).
  const suggestionRead = await supabase
    .from('song_suggestions')
    .select(
      'id, spotify_track_id, title, artist, created_at, guest_sessions!song_suggestions_suggested_by_fkey (display_name)',
    )
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (suggestionRead.error) {
    throw new Error(`readLiveState: song_suggestions read failed: ${suggestionRead.error.code}`);
  }

  const suggestionRows = (suggestionRead.data ?? []) as SuggestionRow[];
  const pendingSuggestionIds = suggestionRows.map((row) => row.id);

  // Vote tally: a SEPARATE bare-column query, never `suggestion_votes(count)`
  // -- PostgREST's aggregate embeds are gated behind db-aggregates-enabled,
  // which this project has never turned on. Tally by hand in TypeScript.
  const voteTally = new Map<string, number>();
  if (pendingSuggestionIds.length > 0) {
    const voteRead = await supabase
      .from('suggestion_votes')
      .select('suggestion_id')
      .in('suggestion_id', pendingSuggestionIds);

    if (voteRead.error) {
      throw new Error(`readLiveState: suggestion_votes read failed: ${voteRead.error.code}`);
    }

    for (const row of (voteRead.data ?? []) as { suggestion_id: string }[]) {
      voteTally.set(row.suggestion_id, (voteTally.get(row.suggestion_id) ?? 0) + 1);
    }
  }

  // Read 3: spotify_track_artists for every distinct track id referenced by
  // either the pending suggestions or the played rows -- its own query, not
  // an embed, because spotify_track_id on both song_suggestions and
  // played_songs is a bare text column matching spotify_tracks' primary key
  // by VALUE, not a declared foreign key PostgREST can traverse.
  const playedRows = event.played_songs ?? [];
  const distinctTrackIds = Array.from(
    new Set([
      ...suggestionRows.map((row) => row.spotify_track_id),
      ...playedRows
        .map((row) => row.spotify_track_id)
        .filter((id): id is string => id !== null),
    ]),
  );

  const artistIdsByTrackId = new Map<string, string[]>();
  if (distinctTrackIds.length > 0) {
    const artistRead = await supabase
      .from('spotify_track_artists')
      .select('spotify_track_id, spotify_artist_id, artist_name')
      .in('spotify_track_id', distinctTrackIds)
      .order('spotify_track_id', { ascending: true })
      .order('ordinal', { ascending: true });

    if (artistRead.error) {
      throw new Error(`readLiveState: spotify_track_artists read failed: ${artistRead.error.code}`);
    }

    for (const row of (artistRead.data ?? []) as { spotify_track_id: string; spotify_artist_id: string }[]) {
      const list = artistIdsByTrackId.get(row.spotify_track_id) ?? [];
      list.push(row.spotify_artist_id);
      artistIdsByTrackId.set(row.spotify_track_id, list);
    }
  }

  // spotify_tracks: the resolved DISPLAY title/artist (design §8.1) --
  // separate from spotify_track_artists above, and from the guest's own
  // untrusted title/artist on song_suggestions. Same "own query, not an
  // embed" reasoning: spotify_track_id is a bare text match, not a declared
  // FK. Screens (Task 16) prefer this over the guest's text when non-null;
  // rankQueue never reads either pair -- matching is on ids only (§4.3).
  const resolvedTrackById = new Map<string, { title: string; artist: string }>();
  if (distinctTrackIds.length > 0) {
    const trackRead = await supabase
      .from('spotify_tracks')
      .select('spotify_track_id, title, artist')
      .in('spotify_track_id', distinctTrackIds);

    if (trackRead.error) {
      throw new Error(`readLiveState: spotify_tracks read failed: ${trackRead.error.code}`);
    }

    for (const row of (trackRead.data ?? []) as { spotify_track_id: string; title: string; artist: string }[]) {
      resolvedTrackById.set(row.spotify_track_id, { title: row.title, artist: row.artist });
    }
  }

  const suggestions: QueueSuggestion[] = suggestionRows.map((row) => {
    const resolved = resolvedTrackById.get(row.spotify_track_id);
    return {
      id: row.id,
      spotifyTrackId: row.spotify_track_id,
      title: row.title,
      artist: row.artist,
      resolvedTitle: resolved?.title ?? null,
      resolvedArtist: resolved?.artist ?? null,
      artistIds: artistIdsByTrackId.get(row.spotify_track_id) ?? [],
      requesters: voteTally.get(row.id) ?? 0,
      createdAt: row.created_at,
      suggestedByName: firstRow(row.guest_sessions)?.display_name ?? '',
    };
  });

  const played: PlayedTrack[] = playedRows.map((row) => ({
    position: row.position,
    spotifyTrackId: row.spotify_track_id,
    artistIds: row.spotify_track_id ? artistIdsByTrackId.get(row.spotify_track_id) ?? [] : [],
  }));

  // Read 4: already exists, just called.
  const genresByArtistId = await readGenresForEvent(eventId);

  return {
    event: { id: event.id, phase: event.phase, phaseStartedAt: event.phase_started_at },
    mustPlay: event.event_must_play ?? [],
    blocklist: event.event_blocklist ?? [],
    played,
    suggestions,
    genresByArtistId,
  };
}

/**
 * guest_sessions is a to-ONE embed (song_suggestions.suggested_by is a single
 * FK to guest_sessions), but PostgREST's exact shape for a to-one embed off a
 * plain (non-unique-PK) foreign key has not been observed against a live
 * response in this DAL, so this normalises either shape the same way
 * detailDal.ts's firstRow() does for its own to-one embeds.
 */
function firstRow<T>(embed: T | T[] | null | undefined): T | undefined {
  if (embed == null) return undefined;
  return Array.isArray(embed) ? embed[0] : embed;
}
