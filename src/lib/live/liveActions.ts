'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import type { EventPhase } from '@/lib/dashboard/types';
import { setPhaseSchema, startEventSchema } from './liveValidation';
import { randomToken } from './token';

/**
 * The upcoming -> live transition and the phase control (design §5.1, §5.3,
 * §5.4). Both are called directly from a Client Component (the pre-flight
 * Start button, the header's phase picker) rather than through a
 * `<form action>`, so the result is a plain discriminated union, not the
 * form-shaped `ActionResult` from `lib/auth/errors`.
 *
 * `reason: 'wrong-state'` on zero rows updated, never a thrown error: the
 * update's own `.eq('status', ...)` filter is what makes "someone else
 * already changed this" distinguishable from "you don't own this event" in
 * the caller's own handling, even though RLS would refuse the latter anyway.
 */
export type LiveActionResult = { ok: true } | { ok: false; reason: 'wrong-state' | 'invalid' };

/**
 * Asia/Jerusalem wall clock, e.g. '20:00'. Never `toISOString().slice(11,16)`:
 * Vercel runs UTC, and `formatStartTime` reads this substring with a regex
 * and never constructs a Date, so a UTC value would render as the wrong time
 * rather than failing (§5.3).
 */
function jerusalemWallClock(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/**
 * upcoming -> live. One statement, five columns: `status` and `phase` must
 * move together (`phase_required_when_live` fires on UPDATE too), and the
 * other three go with them because there is no second statement guaranteed
 * to run -- a `live` row with a null `start_time` or `join_token` is a
 * broken row (§5.3). `join_token` is minted here and only here: the
 * `status = 'upcoming'` guard makes this single-shot, so the token cannot be
 * rotated out from under a QR someone has already scanned.
 */
export async function startEvent(eventId: string, phase: EventPhase): Promise<LiveActionResult> {
  await requireUser();

  const parsed = startEventSchema.safeParse({ eventId, phase });
  if (!parsed.success) return { ok: false, reason: 'invalid' };

  const now = new Date();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('events')
    .update({
      status: 'live',
      phase: parsed.data.phase,
      start_time: jerusalemWallClock(now),
      phase_started_at: now.toISOString(),
      join_token: randomToken(),
    })
    .eq('id', parsed.data.eventId)
    .eq('status', 'upcoming')
    .select();

  if (error) {
    console.error('startEvent: database error', {
      eventId,
      code: error.code,
      message: error.message,
    });
    return { ok: false, reason: 'wrong-state' };
  }
  if (!data || data.length === 0) return { ok: false, reason: 'wrong-state' };

  revalidatePath(`/events/${eventId}/live`);
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

/** `dj_play_suggestion`/`dj_play_pick`'s shared return shape (design §8.4). */
export type PlayResult =
  | { ok: true; position: number; wasAlreadyPlayed: boolean }
  | { ok: false; reason: 'wrong-state' | 'invalid' };

/**
 * Plays a pending suggestion. `dj_play_suggestion` (Migration A) does the
 * real work atomically -- inserts `played_songs` and flips the suggestion's
 * status to `played` in one transaction, under a per-event advisory lock so
 * two Plays landing at once cannot collide on `position`. This wrapper is
 * thin by design: which title/artist get copied (resolved vs. the guest's
 * untrusted text) is the RPC's own decision, not duplicated here.
 */
export async function playSuggestion(eventId: string, suggestionId: string): Promise<PlayResult> {
  await requireUser();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('dj_play_suggestion', {
    p_event_id: eventId,
    p_suggestion_id: suggestionId,
  });

  if (error) {
    console.error('playSuggestion: rpc failed', { eventId, suggestionId, message: error.message });
    return { ok: false, reason: 'wrong-state' };
  }
  const row = (data as { position: number; was_already_played: boolean }[] | null)?.[0];
  if (!row) return { ok: false, reason: 'wrong-state' };

  revalidatePath(`/events/${eventId}/live`);
  return { ok: true, position: row.position, wasAlreadyPlayed: row.was_already_played };
}

/**
 * Plays a DJ pick with no suggestion behind it -- a ceremony cue, a
 * must-play, or any song the DJ chooses directly. `dj_play_pick`'s own
 * 60-second idempotency window (not a unique index) means a double-tap
 * returns the existing position rather than inserting twice, while a
 * legitimate replay later in the night still inserts a new row.
 */
export async function playPick(
  eventId: string,
  title: string,
  artist: string,
  trackId: string,
): Promise<PlayResult> {
  await requireUser();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('dj_play_pick', {
    p_event_id: eventId,
    p_title: title,
    p_artist: artist,
    p_track_id: trackId,
  });

  if (error) {
    console.error('playPick: rpc failed', { eventId, trackId, message: error.message });
    return { ok: false, reason: 'wrong-state' };
  }
  const row = (data as { position: number; was_already_played: boolean }[] | null)?.[0];
  if (!row) return { ok: false, reason: 'wrong-state' };

  revalidatePath(`/events/${eventId}/live`);
  return { ok: true, position: row.position, wasAlreadyPlayed: row.was_already_played };
}

/**
 * Skips a pending suggestion -- sets `status = 'skipped'` and nothing else.
 * Filtered to `status = 'pending'` as a real correctness guard, not
 * decoration: without it, skipping a suggestion the DJ already played (or
 * already skipped) would silently overwrite `played` back to `skipped`,
 * since the RLS update policy itself permits any status transition on the
 * DJ's own event and does not know this rule.
 */
export async function skipSuggestion(eventId: string, suggestionId: string): Promise<LiveActionResult> {
  await requireUser();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('song_suggestions')
    .update({ status: 'skipped' })
    .eq('id', suggestionId)
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .select();

  if (error) {
    console.error('skipSuggestion: database error', {
      eventId,
      suggestionId,
      code: error.code,
      message: error.message,
    });
    return { ok: false, reason: 'wrong-state' };
  }
  if (!data || data.length === 0) return { ok: false, reason: 'wrong-state' };

  revalidatePath(`/events/${eventId}/live`);
  return { ok: true };
}

/**
 * DJ-only phase control (§5.4). `phase_started_at` moves with `phase`,
 * always, in one statement -- they are two halves of one fact ("we have been
 * in open-floor since 21:40"), and updating one without the other would show
 * a countdown for the wrong phase.
 */
export async function setPhase(eventId: string, phase: EventPhase): Promise<LiveActionResult> {
  await requireUser();

  const parsed = setPhaseSchema.safeParse({ eventId, phase });
  if (!parsed.success) return { ok: false, reason: 'invalid' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('events')
    .update({ phase: parsed.data.phase, phase_started_at: new Date().toISOString() })
    .eq('id', parsed.data.eventId)
    .eq('status', 'live')
    .select();

  if (error) {
    console.error('setPhase: database error', {
      eventId,
      code: error.code,
      message: error.message,
    });
    return { ok: false, reason: 'wrong-state' };
  }
  if (!data || data.length === 0) return { ok: false, reason: 'wrong-state' };

  revalidatePath(`/events/${eventId}/live`);
  return { ok: true };
}
