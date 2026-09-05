import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/validation';
import { readLiveState } from '@/lib/live/liveDal';
import { resolveTracks } from '@/lib/spotify/tracks';
import { rankQueue } from '@/lib/live/rank';
import { minutesLeftInPhase as computeMinutesLeftInPhase } from '@/lib/live/phaseClock';

/**
 * GET /api/live/[id]/state -- the DJ live screen's poll route (Task 15,
 * design §8.1, §8.2). DJ-only, and a partner gets 404 rather than 403 --
 * same enumeration-oracle reasoning as `/events/[id]/live`.
 *
 * The blocklist and `genresByArtistId` never cross the wire (design §8.2):
 * this route reads both from `readLiveState` to feed `rankQueue`, but the
 * response only ever carries the ranked output, never the raw rows.
 */
export async function GET(
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

  const state = await readLiveState(id);

  // Some pending suggestions may never have resolved against Spotify at all
  // (artistIds: []). Resolve up to 10 of them, write the results into
  // spotify_tracks/spotify_track_artists so future polls see them as
  // resolved, and patch THIS poll's suggestions in place so the DJ does not
  // wait a whole extra cycle to see a track that resolved just now.
  const unresolvedTrackIds = state.suggestions
    .filter((s) => s.artistIds.length === 0)
    .map((s) => s.spotifyTrackId);

  if (unresolvedTrackIds.length > 0) {
    const resolved = await resolveTracks(unresolvedTrackIds, { max: 10, concurrency: 5 });

    const artistIdsByTrackId = new Map<string, string[]>();
    for (const track of resolved) {
      artistIdsByTrackId.set(
        track.id,
        track.artists.map((a) => a.id),
      );

      await supabase.from('spotify_tracks').upsert({
        spotify_track_id: track.id,
        title: track.title,
        artist: track.artist,
      });

      // Upsert keyed on (spotify_track_id, ordinal) rather than
      // delete-then-insert: one query, no window where a concurrent reader
      // could see a track with zero artist rows mid-write.
      const artistRows = track.artists.map((a, ordinal) => ({
        spotify_track_id: track.id,
        ordinal,
        spotify_artist_id: a.id,
        artist_name: a.name,
      }));
      if (artistRows.length > 0) {
        await supabase
          .from('spotify_track_artists')
          .upsert(artistRows, { onConflict: 'spotify_track_id,ordinal' });
      }
    }

    // In-place patch (cheaper than re-calling readLiveState): the resolved
    // array's own `artists` field already has everything needed.
    if (artistIdsByTrackId.size > 0) {
      state.suggestions = state.suggestions.map((s) => {
        const artistIds = artistIdsByTrackId.get(s.spotifyTrackId);
        return artistIds ? { ...s, artistIds } : s;
      });
    }
  }

  const now = new Date();
  const minsLeft = computeMinutesLeftInPhase(state.event.phase, state.event.phaseStartedAt, now);

  const { queue, blocked } = rankQueue({
    suggestions: state.suggestions,
    mustPlay: state.mustPlay,
    blocklist: state.blocklist,
    genresByArtistId: state.genresByArtistId,
    played: state.played,
    phase: state.event.phase,
    minutesLeftInPhase: minsLeft,
  });

  // mustPlayProgress counts ALL segments, not just the current phase's
  // (design §6.2-i: "must-plays covered" is a whole-evening number).
  const playedTrackIds = new Set(
    state.played
      .map((p) => p.spotifyTrackId)
      .filter((trackId): trackId is string => trackId !== null),
  );
  const mustPlayPlayed = state.mustPlay.filter(
    (row) => row.spotify_track_id !== null && playedTrackIds.has(row.spotify_track_id),
  ).length;
  const mustPlayProgress = { played: mustPlayPlayed, total: state.mustPlay.length };

  // The distinct artist ids across every suggestion (after resolution above)
  // with NO entry in genresByArtistId -- resolved as a track/artist, but not
  // yet genre-enriched. An entry that is present but empty ({}) counts as
  // checked, mirroring rank.ts's own genre-pending semantics.
  const allArtistIds = new Set(state.suggestions.flatMap((s) => s.artistIds));
  const unresolvedArtistIds = Array.from(allArtistIds).filter(
    (artistId) => !(artistId in state.genresByArtistId),
  );

  return NextResponse.json({
    queue,
    blocked,
    activity: [],
    mustPlayProgress,
    unresolvedArtistIds,
    now: now.toISOString(),
  });
}
