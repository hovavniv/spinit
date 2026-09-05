import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { mapGuestError, type GuestErrorCode } from './guestErrors';

/**
 * Read-only wrappers around the two guest RPCs that only READ
 * (`guest_event`, `guest_queue`) -- design §4.4. Both call `createClient()`
 * with no auth session on a guest route, so PostgREST executes them as
 * `anon` automatically (there is no separate anon-client factory in this
 * repo).
 *
 * Every RPC failure is mapped through `guestErrors.ts` and returned as a
 * tagged result rather than thrown, mirroring `guestActions.ts`'s own
 * result shape -- callers (the two `/join/[token]` pages) branch on `ok`
 * rather than wrapping every read in a try/catch.
 */

export type GuestDalResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: GuestErrorCode | 'unknown'; message: string };

export interface GuestEventInfo {
  coupleNames: string;
  isLive: boolean;
}

export async function readGuestEvent(token: string): Promise<GuestDalResult<GuestEventInfo>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('guest_event', { p_token: token });

  if (error) {
    return { ok: false, ...mapGuestError(error) };
  }

  const row = (data as { couple_names: string; is_live: boolean }[] | null)?.[0];
  if (!row) {
    // Defensive: `guest_event` always raises `no_such_event` rather than
    // returning zero rows, but a zero-row result is treated identically
    // rather than assumed unreachable.
    return { ok: false, ...mapGuestError({ message: 'no_such_event' }) };
  }

  return { ok: true, data: { coupleNames: row.couple_names, isLive: row.is_live } };
}

export interface GuestQueueRow {
  suggestionId: string;
  title: string;
  artist: string;
  votes: number;
  voted: boolean;
  mine: boolean;
}

export interface GuestQueueState {
  queue: GuestQueueRow[];
  /**
   * This guest's own suggestion count (of 3). `guest_queue` returns it as a
   * repeated per-row column, so it is only observable when at least one row
   * comes back -- if the event's whole pending queue is empty, there is no
   * row to read it off, and this defaults to 0. That default is a known
   * limit of the RPC's own shape (Migration B, not modified by this task),
   * not a re-derivation of the cap from the queue rows.
   */
  usedCount: number;
}

export async function readGuestQueue(sessionId: string): Promise<GuestDalResult<GuestQueueState>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('guest_queue', { p_session_id: sessionId });

  if (error) {
    return { ok: false, ...mapGuestError(error) };
  }

  const rows = (data ?? []) as {
    suggestion_id: string;
    title: string;
    artist: string;
    votes: number;
    voted: boolean;
    mine: boolean;
    used_count: number;
  }[];

  return {
    ok: true,
    data: {
      // Ordered by votes desc, created_at, id -- server-side, in the RPC
      // itself (design §4.4). Never re-sorted here.
      queue: rows.map((row) => ({
        suggestionId: row.suggestion_id,
        title: row.title,
        artist: row.artist,
        votes: row.votes,
        voted: row.voted,
        mine: row.mine,
      })),
      usedCount: rows[0]?.used_count ?? 0,
    },
  };
}
