import { PHASE_GENRES, PHASE_SEGMENT } from './phaseSegment';
import { UNRESOLVABLE_TRACK_TITLE } from './liveTypes';
import type { QueueSuggestion, RankedSong, RankInput, Reason } from './liveTypes';

/**
 * The explainable ranking engine (design §6.2-i). Pure, deterministic, no I/O.
 *
 * Terms, in order:
 *  1. Already played        -- filter, no reason (row is gone, not shown).
 *  2. Blocked                -- partition into `blocked`, segment-scoped.
 *  3. Requesters              +1 per distinct requester (base score).
 *  4. Unplayed must-play      +25, segment-scoped.
 *  5. Artist repeat           -15, only within the last 3 played.
 *  6. Phase fit                +/-8, wants beats avoids when both match.
 *  7. Phase-ending must-play  +10, only on top of an already-fired term 4.
 *
 * All matching is on Spotify ids, never on guest-supplied title/artist text.
 */
export function rankQueue(input: RankInput): { queue: RankedSong[]; blocked: RankedSong[] } {
  const { suggestions, mustPlay, blocklist, genresByArtistId, played, phase, minutesLeftInPhase } =
    input;

  const segment = PHASE_SEGMENT[phase];

  // Term 1: already played -- remove entirely, matched on spotifyTrackId only.
  const playedTrackIds = new Set(
    played.map((p) => p.spotifyTrackId).filter((id): id is string => id !== null),
  );
  const notPlayed = suggestions.filter((s) => !playedTrackIds.has(s.spotifyTrackId));

  // Segment-scoped blocklist rows only.
  const scopedBlocklist = blocklist.filter((row) => row.segment === segment);
  const blockedSongIds = new Set(
    scopedBlocklist.filter((row) => row.entry_type === 'song').map((row) => row.spotify_id),
  );
  const blockedArtistIds = new Set(
    scopedBlocklist.filter((row) => row.entry_type === 'artist').map((row) => row.spotify_id),
  );
  const blockedGenres = new Set(
    scopedBlocklist.filter((row) => row.entry_type === 'genre').map((row) => row.value),
  );

  // Segment-scoped, unplayed must-play track ids (term 4).
  const mustPlayTrackIds = new Set(
    mustPlay
      .filter((row) => row.segment === segment)
      .map((row) => row.spotify_track_id)
      .filter((id): id is string => id !== null)
      .filter((id) => !playedTrackIds.has(id)),
  );

  const queue: RankedSong[] = [];
  const blockedRows: RankedSong[] = [];

  for (const suggestion of notPlayed) {
    // Term 2: blocked -- song, then artist, then genre. First match wins.
    const blockedReason = findBlockReason(
      suggestion,
      blockedSongIds,
      blockedArtistIds,
      blockedGenres,
      genresByArtistId,
    );
    if (blockedReason !== null) {
      blockedRows.push({
        suggestion,
        rank: 0,
        score: 0,
        reasons: [],
        blocked: blockedReason,
      });
      continue;
    }

    const reasons: Reason[] = [];
    let score = 0;

    // Term 3: requesters -- base score, always present.
    score += suggestion.requesters;
    reasons.push({ kind: 'requesters', count: suggestion.requesters });

    // Term 4: unplayed must-play.
    const isMustPlay = mustPlayTrackIds.has(suggestion.spotifyTrackId);
    if (isMustPlay) {
      score += 25;
      reasons.push({ kind: 'must-play-unplayed' });
    }

    // Term 5: artist repeat -- within the last 3 played entries only.
    const lastThree = played.slice(Math.max(0, played.length - 3));
    let repeatFound: { artist: string; songsAgo: number } | null = null;
    for (let i = lastThree.length - 1; i >= 0; i--) {
      const playedRow = lastThree[i];
      if (playedRow.artistIds.length === 0) continue;
      const shared = suggestion.artistIds.some((id) => playedRow.artistIds.includes(id));
      if (shared) {
        const songsAgo = lastThree.length - i;
        if (repeatFound === null || songsAgo < repeatFound.songsAgo) {
          // M4: the DECISION above is id-based (`playedRow.artistIds`); the
          // EXPLANATION should be too, wherever a resolved name exists --
          // the guest's own `artist` text is unverified free text, and this
          // sentence is what the DJ reads out loud.
          repeatFound = { artist: suggestion.resolvedArtist ?? suggestion.artist, songsAgo };
        }
      }
    }
    if (repeatFound !== null) {
      score -= 15;
      reasons.push({ kind: 'artist-repeat', artist: repeatFound.artist, songsAgo: repeatFound.songsAgo });
    }

    // Term 6: phase fit.
    //
    // genre-pending fires on EITHER of two states the DJ cannot tell apart by
    // looking at the queue otherwise (design §6.2b, widened 2026-09-05,
    // Task 12a): a track with no resolved artists at all, OR one whose
    // artists are resolved but have no genresByArtistId ENTRY yet (not
    // enriched). Both mean "the do-not-play genre check has not run for this
    // song" -- and a song that was never checked must not look identical to
    // one that WAS checked and genuinely has no matching genre. `anyResolved`
    // tracks entry PRESENCE, deliberately distinct from whether that entry
    // has any genre keys: an artist resolved with zero identified genres
    // (a real, valid outcome) still counts as checked and gets no reason at
    // all, same as before -- only a MISSING entry means "not yet known".
    if (suggestion.artistIds.length > 0) {
      const wants = new Set(PHASE_GENRES[phase].wants);
      const avoids = new Set(PHASE_GENRES[phase].avoids);
      let anyResolved = false;
      let fitsWants = false;
      let fitsAvoids = false;
      for (const artistId of suggestion.artistIds) {
        const genres = genresByArtistId[artistId];
        if (genres === undefined) continue;
        anyResolved = true;
        for (const genre of Object.keys(genres)) {
          if (wants.has(genre)) fitsWants = true;
          if (avoids.has(genre)) fitsAvoids = true;
        }
      }
      if (fitsWants) {
        score += 8;
        reasons.push({ kind: 'phase-fit', phase, fits: true });
      } else if (fitsAvoids) {
        score -= 8;
        reasons.push({ kind: 'phase-fit', phase, fits: false });
      } else if (!anyResolved) {
        reasons.push({ kind: 'genre-pending' });
      }
      // else: every artist resolved, none matched wants or avoids -- checked,
      // genuinely no signal. No reason, no score change.
    } else if (suggestion.resolvedTitle === UNRESOLVABLE_TRACK_TITLE) {
      // F1: this id was looked up and Spotify came back 404 -- it is not a
      // real track, permanently, not merely "not checked yet". Distinct
      // from genre-pending below so the DJ never reads "not yet checked" on
      // a row that in fact can never be checked. Also correctly never
      // blockable: findBlockReason above already found nothing (artistIds
      // is empty), which is right -- there is nothing to block.
      reasons.push({ kind: 'unresolvable' });
    } else {
      // No resolved artists at all -- the track itself hasn't resolved yet.
      reasons.push({ kind: 'genre-pending' });
    }

    // Term 7: phase ending -- only boosts an already-fired must-play.
    if (isMustPlay && minutesLeftInPhase !== null && minutesLeftInPhase < 15) {
      score += 10;
      reasons.push({ kind: 'phase-ending', phase, minutesLeft: minutesLeftInPhase });
    }

    queue.push({ suggestion, rank: 0, score, reasons, blocked: null });
  }

  queue.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.suggestion.createdAt !== b.suggestion.createdAt) {
      return a.suggestion.createdAt < b.suggestion.createdAt ? -1 : 1;
    }
    if (a.suggestion.id !== b.suggestion.id) {
      return a.suggestion.id < b.suggestion.id ? -1 : 1;
    }
    return 0;
  });

  queue.forEach((row, index) => {
    row.rank = index + 1;
  });

  return { queue, blocked: blockedRows };
}

function findBlockReason(
  suggestion: QueueSuggestion,
  blockedSongIds: Set<string | null>,
  blockedArtistIds: Set<string | null>,
  blockedGenres: Set<string>,
  genresByArtistId: Record<string, Record<string, number>>,
): Reason | null {
  if (blockedSongIds.has(suggestion.spotifyTrackId)) {
    // M4: the decision is id-based (`spotifyTrackId`); prefer the resolved
    // title for the sentence the DJ reads, since the guest's own `title` is
    // unverified free text and can name a fabrication.
    return { kind: 'blocked-song', title: suggestion.resolvedTitle ?? suggestion.title };
  }

  for (const artistId of suggestion.artistIds) {
    if (blockedArtistIds.has(artistId)) {
      return { kind: 'blocked-artist', artist: suggestion.resolvedArtist ?? suggestion.artist };
    }
  }

  for (const artistId of suggestion.artistIds) {
    const genres = genresByArtistId[artistId];
    if (genres === undefined) continue;
    for (const genre of Object.keys(genres)) {
      if (blockedGenres.has(genre)) {
        return { kind: 'blocked-genre', genre };
      }
    }
  }

  return null;
}
