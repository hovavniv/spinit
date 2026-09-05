import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/validation';
import { readActivity, readLiveState } from '@/lib/live/liveDal';
import { UNRESOLVABLE_TRACK_TITLE, UNRESOLVABLE_TRACK_ARTIST } from '@/lib/live/liveTypes';
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
  // Task 24: its own reads, separate from readLiveState -- see readActivity's
  // own header comment for why this is a clearly separated concern.
  const activity = await readActivity(id);

  // Some pending suggestions may never have been LOOKED UP against Spotify
  // at all yet -- gated on `resolvedTitle`, not `artistIds` (F1): a track
  // this route already marked unresolvable (below) also has `artistIds: []`
  // forever, and re-including it here on every poll is exactly the bug --
  // it would consume a resolution slot ahead of a genuinely-unchecked
  // suggestion, for ever. `resolvedTitle` is only non-null once a
  // `spotify_tracks` row exists, real or sentinel, so it alone tells apart
  // "not yet asked" from "asked, and here's the answer".
  const unresolvedTrackIds = state.suggestions
    .filter((s) => s.resolvedTitle === null)
    .map((s) => s.spotifyTrackId);

  if (unresolvedTrackIds.length > 0) {
    const { resolved, notFound } = await resolveTracks(unresolvedTrackIds, { max: 10, concurrency: 5 });

    const artistIdsByTrackId = new Map<string, string[]>();
    const displayByTrackId = new Map<string, { title: string; artist: string }>();
    for (const track of resolved) {
      const trackUpsert = await supabase.from('spotify_tracks').upsert({
        spotify_track_id: track.id,
        title: track.title,
        artist: track.artist,
      });
      // F5: this write was previously unchecked. A failure here must not
      // read as success -- log it, and leave this track OUT of both patch
      // maps below so THIS poll's response still shows it unresolved,
      // matching the database (its row never landed, so `resolvedTitle`
      // stays null and it's simply retried on the next poll) rather than
      // showing "resolved" while the write silently failed.
      if (trackUpsert.error) {
        console.error('state poll: spotify_tracks upsert failed', {
          eventId: id,
          trackId: track.id,
          error: trackUpsert.error,
        });
        continue;
      }

      artistIdsByTrackId.set(
        track.id,
        track.artists.map((a) => a.id),
      );
      displayByTrackId.set(track.id, { title: track.title, artist: track.artist });

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
        const artistUpsert = await supabase
          .from('spotify_track_artists')
          .upsert(artistRows, { onConflict: 'spotify_track_id,ordinal' });
        if (artistUpsert.error) {
          console.error('state poll: spotify_track_artists upsert failed', {
            eventId: id,
            trackId: track.id,
            error: artistUpsert.error,
          });
        }
      }
    }

    // F1: a 404 is an answer, not a failure -- write a sentinel
    // `spotify_tracks` row (never the guest's own text) so this id leaves
    // `unresolvedTrackIds` for good instead of consuming a resolution slot
    // on every poll for ever. No `spotify_track_artists` rows: it is not a
    // real track, so it must keep `artistIds: []` -- still correctly
    // un-blockable, and `rank.ts` renders it as `unresolvable` rather than
    // `genre-pending` so the DJ can tell "never checked" apart from
    // "checked, and it isn't real".
    for (const trackId of notFound) {
      const trackUpsert = await supabase.from('spotify_tracks').upsert({
        spotify_track_id: trackId,
        title: UNRESOLVABLE_TRACK_TITLE,
        artist: UNRESOLVABLE_TRACK_ARTIST,
      });
      if (trackUpsert.error) {
        console.error('state poll: spotify_tracks upsert failed (unresolvable)', {
          eventId: id,
          trackId,
          error: trackUpsert.error,
        });
        continue;
      }
      displayByTrackId.set(trackId, { title: UNRESOLVABLE_TRACK_TITLE, artist: UNRESOLVABLE_TRACK_ARTIST });
    }

    // In-place patch (cheaper than re-calling readLiveState): the resolved
    // array's own fields already have everything needed, including the
    // resolved display title/artist -- so a track resolved mid-poll shows
    // its real name immediately too, not just its artist ids. A `notFound`
    // id is patched the same way, with `artistIds` left at `[]`.
    if (displayByTrackId.size > 0) {
      state.suggestions = state.suggestions.map((s) => {
        const display = displayByTrackId.get(s.spotifyTrackId);
        if (!display) return s;
        return {
          ...s,
          artistIds: artistIdsByTrackId.get(s.spotifyTrackId) ?? s.artistIds,
          resolvedTitle: display.title,
          resolvedArtist: display.artist,
        };
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
    activity,
    mustPlayProgress,
    unresolvedArtistIds,
    // Additive field: CeremonyCues and CoupleRules' "Played" column both
    // match on spotify_track_id against this array. Without it, a song
    // played after the first paint never turns green on screen until a
    // manual refresh -- mustPlayProgress's aggregate count updates but the
    // specific rows do not, which is worse than not showing progress at all
    // (the count and the list would visibly disagree). No contract break:
    // readLiveState already returns this, it just wasn't in the response.
    played: state.played,
    now: now.toISOString(),
  });
}
