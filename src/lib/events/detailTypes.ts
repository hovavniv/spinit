/* ---------------------------------------------------------------------------
   Row and page shapes for the event page
   (docs/specs/2026-08-30-event-detail-design.md §6.1).

   Deliberately free of logic and of `import 'server-only'`: the list sections
   are Client Components and import these types, which is exactly why they do
   not live in detailDal.ts (the reasoning src/lib/events/types.ts records).
   --------------------------------------------------------------------------- */

import type { ActionResult } from '@/lib/auth/errors';
import type { TasteProfile } from '@/lib/spotify/tasteTypes';

export type EventSegment = 'ceremony' | 'reception' | 'party';

/** The two segments a DJ can add rows to. Ceremony is written only by its slots. */
export type AddableSegment = Exclude<EventSegment, 'ceremony'>;

export type BlocklistEntryType = 'artist' | 'song' | 'genre';

/**
 * The key a row's thumbnail lives under in `EventDetail.artworkById`.
 *
 * Prefixed by kind, never the bare Spotify id: ids are only unique WITHIN a
 * type, so a bare-id map is ambiguous the day a track and an artist share one.
 * Declared here rather than beside `resolveArtwork` so a Client Component can
 * build the key without importing that `import 'server-only'` module.
 */
export function artworkKey(kind: 'track' | 'artist', id: string | null | undefined): string {
  return id ? `${kind}:${id}` : '';
}

export interface MustPlayRow {
  id: string;
  segment: EventSegment;
  title: string;
  artist: string | null;
  moment: string | null;
  /** Null only for a row written before the picker existed (plan task 12/13 clears these). */
  spotify_track_id: string | null;
  spotify_artist_id: string | null;
  /** ISO instant. Used for ordering at the query, not rendered. */
  created_at: string;
}

export interface BlocklistRow {
  id: string;
  segment: EventSegment;
  entry_type: BlocklistEntryType;
  value: string;
  /** Null for a genre entry (design §5.6) or a pre-picker row; never null for artist/song. */
  spotify_id: string | null;
  created_at: string;
}

/**
 * The state a list form's action returns. `null` is "no submission yet" — an
 * initial `{ ok: true }` would flash "Saved ✓" the moment the page loads.
 *
 * Declared HERE rather than in detailActions.ts so a Client Component never
 * imports anything from a `'use server'` module: a type import is erased at
 * build time and would work, but it leaves a client file importing from a
 * server module, which is a trap for whoever edits it next — the same reason
 * these row types are not in the DAL.
 */
export type DetailActionState = ActionResult | null;

export interface PartnerRow {
  id: string;
  slot: 1 | 2;
  display_name: string;
  /** Null between the DJ sending the invite and the partner claiming the slot. */
  user_id: string | null;
  /** Null when no spotify_connections row exists yet for this partner. */
  connection: { status: 'invited' | 'connected' | 'failed' } | null;
  /** Null when no taste_profiles row exists yet for this partner. */
  profile: TasteProfile | null;
}

/**
 * Who is looking at the event page (design §4). Resolved on the server in
 * page.tsx and passed down; null means "neither", which the route turns into
 * notFound() — never a 403, which would confirm the id is real and turn the
 * route into an oracle for enumerating event ids.
 */
export type Viewer = { role: 'dj' } | { role: 'partner'; partnerId: string };

export interface EventDetail {
  id: string;
  /** The owner. The route needs it to resolve the viewer (design §4). */
  dj_id: string;
  couple_names: string;
  /**
   * Needed to decide whether the End event button renders (design §3.6).
   * The five-value union is spelled out because this repo has no shared
   * EventStatus type; src/lib/dashboard/fromDb.ts:52 is the same spelling.
   */
  status: 'draft' | 'upcoming' | 'live' | 'completed' | 'cancelled';
  /** 'YYYY-MM-DD'. Never pass this to `new Date(string)` — see format.ts. */
  event_date: string;
  /**
   * The two note bodies (design §3, §5.2). Strings, never null: both tables
   * default the body to '' and the migration backfills a row per event.
   *
   * Each note table's `event_id` is both primary key and foreign key, which
   * is PostgREST's one-to-one detection condition, so the DAL reads the
   * embed back as an OBJECT (`{ body }`), not an array — see
   * `firstRow()` in detailDal.ts.
   *
   * `privateNotes` is '' for a partner because their read returns no row at
   * all — the policy filters it. That is the boundary working, not an error.
   */
  privateNotes: string;
  sharedNotes: string;
  partners: PartnerRow[];
  mustPlay: MustPlayRow[];
  blocklist: BlocklistRow[];
  /**
   * Resolved genres for every artist enriched so far, keyed by
   * spotify_artist_id (design §5.1, plan task 8b). `artist_genres` is its own
   * query in the DAL, not an embed on `events` -- it has no foreign key to
   * events, only a plain `event_id` column, so PostgREST has no relationship
   * to traverse. `{}` means "nothing enriched yet", not "the query failed" --
   * a failed query throws instead, so the two cases never collapse into the
   * same value on the page.
   *
   * TASK 9 SEAM: not yet consumed anywhere. `TasteProfile` (task 9) is the
   * first thing that reads this.
   */
  genresByArtistId: Record<string, Record<string, number>>;
  /**
   * Thumbnail URLs for the rows on this page, keyed by `artworkKey(...)`.
   *
   * Resolved from Spotify at read time rather than stored: an image URL is not
   * promised to stay valid, so a column holding one rots silently. A missing
   * entry is normal and means "no picture" -- a pre-picker row with no id, a
   * genre entry, a track Spotify 404s on, or a call that failed. Never an
   * error: `resolveArtwork` swallows every failure, because a thumbnail must
   * not be able to take the page down.
   */
  artworkById: Record<string, string>;
  /**
   * `enrichment_queue` counts for BOTH partners, summed (fix-spec Blocker 1).
   * The DJ cannot poll `/api/spotify/enrich-next` (partner-only by design),
   * so this server-computed value is the ONLY way the DJ's `TasteProfile`
   * ever sees real progress -- `TasteProfileClient` seeds from this and lets
   * a successful poll (partner viewers only) override it.
   */
  enrichmentProgress: { settled: number; total: number };
}
