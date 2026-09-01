/* ---------------------------------------------------------------------------
   Pure row-to-props mappers for the DJ Dashboard
   (docs/specs/2026-08-29-dashboard-data-design.md §6).

   No React, no Supabase, no clock — the same shape as lib/validation.ts and
   lib/heroDemo.ts. This is where this slice's logic lives, so this is where
   its tests point.
   --------------------------------------------------------------------------- */

import type { Profile } from '@/lib/auth/dal';
import type {
  CoupleStatus,
  DashboardData,
  EventPhase,
  LiveEvent,
  PastEvent,
  UpcomingEvent,
} from './types';

type SpotifyConnStatus = 'invited' | 'connected' | 'failed';

/**
 * A partner slot's connection status, as embedded by `EVENT_COLUMNS`.
 *
 * `spotify_connections` is keyed on `partner_id` (unique), so at the wire it
 * embeds to-one — an object or `null`, never an array. But `createClient()`
 * (src/lib/supabase/server.ts) is built with no generated `Database` schema
 * type, so postgrest-js's compile-time select-string parser has no
 * uniqueness metadata to detect that from and falls back to typing every
 * nested embed as an array, regardless of the real cardinality. Typed here as
 * "object, array, or null" and normalised with `firstRow()` below, the same
 * way `src/lib/events/detailDal.ts`'s `firstRow()` already does for this
 * exact relationship — asserting the narrower object-only shape instead
 * produces a TS2352 cast error against what the client actually infers.
 */
interface EventPartnerRow {
  spotify_connections: { status: SpotifyConnStatus } | { status: SpotifyConnStatus }[] | null;
}

/** Normalises a to-one embed to its single row, whichever shape it arrives as. */
function firstRow<T>(embed: T | T[] | null | undefined): T | undefined {
  if (embed == null) return undefined;
  return Array.isArray(embed) ? embed[0] : embed;
}

/** A row of `public.events`, as this branch selects it (design §5). */
export interface DashboardEventRow {
  id: string;
  couple_names: string;
  venue: string;
  event_date: string; // 'YYYY-MM-DD'
  status: 'draft' | 'upcoming' | 'live' | 'completed' | 'cancelled';
  phase: EventPhase | null;
  start_time: string | null; // 'HH:mm:ss'
  // `event_partners` is to-many from `events` (its FK is not unique), so this
  // one IS an array — the other half of the same embed-cardinality trap.
  event_partners: EventPartnerRow[];
}

/**
 * Derived, never stored: a partner's own session cannot write `events` (its
 * UPDATE policy is `auth.uid() = dj_id`), so the status is computed from the
 * connection rows the DJ can already read (`dj or participant selects
 * partners` on `event_partners`; `participants select connections` on
 * `spotify_connections`).
 *
 * Counts connected partners and requires at least two, rather than asserting
 * "no partner is unconnected" — `every()` over an empty or one-element array
 * is vacuously true, which would read a half-set-up or partner-less event as
 * connected.
 */
function coupleStatusOf(row: DashboardEventRow): CoupleStatus {
  const connected = (row.event_partners ?? []).filter(
    (p) => firstRow(p.spotify_connections)?.status === 'connected',
  ).length;
  return connected >= 2 ? 'streaming-connected' : 'awaiting-couple';
}

/**
 * The one live event, or null.
 *
 * Design §6's rule is "the single row with `status === 'live'` AND a non-null
 * `start_time`" — both conditions are checked together while searching, not
 * `.find(r => r.status === 'live')` followed by a separate null check.
 * Nothing in the schema forbids two `live` rows (no partial unique index, no
 * check constraint), and with ascending `event_date` ordering the naive
 * two-step version would return the earlier row and — if that one had a null
 * `start_time` — the genuinely live event would never show a banner.
 *
 * A `live` row with a null `start_time` is inconsistent data: the banner would
 * read "started at " with nothing after it. Likewise a `live` row with a null
 * `phase`: the schema's `phase_required_when_live` check constraint (design
 * §4) makes this impossible at the database layer, but `DashboardEventRow`
 * types `phase` as `EventPhase | null` because every other status permits
 * null, and this function does not trust a constraint it cannot see. Either
 * case is treated as not-live and logged, rather than rendered, but only when
 * it is the reason nothing qualifies — a broken live row that is shadowed by
 * a genuine one is not an error worth logging. Stated because "it can't
 * happen" is how it happens.
 */
export function toLiveEvent(rows: DashboardEventRow[]): LiveEvent | null {
  const liveRows = rows.filter((row) => row.status === 'live');
  const live = liveRows.find(
    (row): row is DashboardEventRow & { phase: EventPhase; start_time: string } =>
      row.phase !== null && row.start_time !== null,
  );

  if (live === undefined) {
    if (liveRows.length > 0) {
      console.error('toLiveEvent: live event has no phase or no start_time; not rendering the banner', {
        eventId: liveRows[0].id,
      });
    }
    return null;
  }

  return {
    id: live.id,
    coupleNames: live.couple_names,
    venue: live.venue,
    phase: live.phase,
    // 'HH:mm:ss' -> 'HH:mm'. Composed as a bare local wall clock with no
    // offset, which is what formatStartTime's regex reads (design §4).
    startedAt: `${live.event_date}T${live.start_time.slice(0, 5)}`,
  };
}

/**
 * A row of `public.past_events_with_counts`, as this branch consumes it.
 *
 * Declared here rather than imported from `src/lib/events/dal.ts`, which
 * belongs to feat/past-events and does not exist yet: importing from it would
 * mean this branch cannot typecheck until their code lands (design §5). One
 * duplicated five-field interface is the price; a branch that cannot run
 * `npm run typecheck` is worse.
 */
export interface PastEventCountRow {
  id: string;
  couple_names: string;
  venue: string;
  event_date: string; // 'YYYY-MM-DD'
  songs_played: number;
}

/** Every `upcoming` row, in the order the query returned them. */
export function toUpcomingEvents(rows: DashboardEventRow[]): UpcomingEvent[] {
  return rows
    .filter((row) => row.status === 'upcoming')
    .map((row) => ({
      id: row.id,
      coupleNames: row.couple_names,
      venue: row.venue,
      date: row.event_date,
      status: coupleStatusOf(row),
    }));
}

/** View rows to the past-events card's props. */
export function toPastEvents(rows: PastEventCountRow[]): PastEvent[] {
  return rows.map((row) => ({
    id: row.id,
    coupleNames: row.couple_names,
    venue: row.venue,
    date: row.event_date,
    songsPlayed: row.songs_played,
  }));
}

interface DashboardDataInput {
  profile: Profile | null;
  activeRows: DashboardEventRow[];
  pastRows: PastEventCountRow[];
  now: string;
}

/**
 * The whole `DashboardData` object the screen takes.
 *
 * `profile` may be null: `getProfile()` returns null when the read failed
 * rather than throwing, and a dashboard that renders with an empty name beats
 * a route that 500s.
 */
export function toDashboardData({
  profile,
  activeRows,
  pastRows,
  now,
}: DashboardDataInput): DashboardData {
  return {
    dj: {
      name: profile?.full_name ?? '',
      // business_name is nullable and DjProfile.company is not. An empty
      // company renders as an empty line rather than the string "null".
      company: profile?.business_name ?? '',
    },
    now,
    liveEvent: toLiveEvent(activeRows),
    upcoming: toUpcomingEvents(activeRows),
    past: toPastEvents(pastRows),
  };
}
