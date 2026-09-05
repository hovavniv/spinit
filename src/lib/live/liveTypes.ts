import type { EventPhase } from '@/lib/dashboard/types';
import type { BlocklistRow, MustPlayRow } from '@/lib/events/detailTypes';

/**
 * The sentinel `spotify_tracks.title` the poll route (F1) writes for a track
 * id that came back a genuine 404 from Spotify -- not a real track, and
 * never going to become one on retry. `rank.ts` checks for exactly this
 * value to tell "resolved, and it's not a real track" apart from "not yet
 * looked up" (both leave `artistIds: []`, the only field ranking itself
 * matches on). Never the guest's own `artist`/`title` text (design §3.3).
 */
export const UNRESOLVABLE_TRACK_TITLE = 'Unavailable track';

/**
 * The sentinel `spotify_tracks.artist` written alongside `UNRESOLVABLE_TRACK_TITLE`.
 * Cannot be `''` -- `artist_len` requires `char_length(artist) between 1 and 200`,
 * so an empty string fails the upsert and the row (and the fix) never lands.
 * Display-only, like the title, and never matched on.
 */
export const UNRESOLVABLE_TRACK_ARTIST = '—';

/** One pending suggestion, with everything rankQueue needs already resolved. */
export interface QueueSuggestion {
  id: string;
  spotifyTrackId: string;
  /** Untrusted guest display text (S3.3). Never matched on. */
  title: string;
  artist: string;
  /**
   * The resolved `spotify_tracks` title/artist, when a row exists -- null
   * otherwise. Screens (Task 16) render these over the guest's own text
   * whenever non-null (design §8.1); ranking never reads either pair, since
   * matching is on ids only (§4.3).
   */
  resolvedTitle: string | null;
  resolvedArtist: string | null;
  /** Resolved from spotify_track_artists by the DAL. EMPTY when unresolved. */
  artistIds: string[];
  /** Distinct guests who suggested or backed it. */
  requesters: number;
  createdAt: string;
  suggestedByName: string;
}

/** A played song, with its artists resolved the same way. */
export interface PlayedTrack {
  position: number;
  spotifyTrackId: string | null;
  artistIds: string[];
}

export type Reason =
  | { kind: 'requesters'; count: number }
  | { kind: 'must-play-unplayed' }
  | { kind: 'artist-repeat'; artist: string; songsAgo: number }
  | { kind: 'blocked-song'; title: string }
  | { kind: 'blocked-artist'; artist: string }
  | { kind: 'blocked-genre'; genre: string }
  | { kind: 'phase-fit'; phase: EventPhase; fits: boolean }
  | { kind: 'phase-ending'; phase: EventPhase; minutesLeft: number }
  | { kind: 'genre-pending' }
  | { kind: 'unresolvable' };

export interface RankedSong {
  suggestion: QueueSuggestion;
  rank: number;
  score: number;
  reasons: Reason[];
  blocked: Reason | null;
}

/**
 * One line of the DJ's live activity feed (design §7.1, Task 24): a guest
 * requesting or backing (voting for) a song, newest first. `guestName`,
 * `title` and `artist` are all the guest's own UNTRUSTED display text
 * (§3.3/§4.8) -- fine to display, same as `QueueSuggestion.title`/`artist`
 * above; React's own escaping handles the XSS surface, this is not an
 * escaping concern. Never matched on.
 */
export interface ActivityItem {
  id: string;
  verb: 'requested' | 'backed';
  guestName: string;
  title: string;
  artist: string;
  createdAt: string;
}

export interface RankInput {
  suggestions: QueueSuggestion[];
  mustPlay: MustPlayRow[];
  blocklist: BlocklistRow[];
  /** spotify_artist_id -> genre -> weight. From readGenresForEvent. */
  genresByArtistId: Record<string, Record<string, number>>;
  played: PlayedTrack[];
  phase: EventPhase;
  /** null = no phase clock (S5.4). The time terms do not fire. */
  minutesLeftInPhase: number | null;
}
