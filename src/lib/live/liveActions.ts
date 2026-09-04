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
