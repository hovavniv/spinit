import type { EventPhase } from '@/lib/dashboard/types';
import type { BlocklistRow, MustPlayRow } from '@/lib/events/detailTypes';

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
  | { kind: 'genre-pending' };

export interface RankedSong {
  suggestion: QueueSuggestion;
  rank: number;
  score: number;
  reasons: Reason[];
  blocked: Reason | null;
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
