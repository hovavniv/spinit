'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import type { ActionResult } from '@/lib/auth/errors';
import {
  formDataToRecord,
  mustPlayAddSchema,
  blocklistAddSchema,
  rowRefSchema,
  eventDetailsSchema,
  ceremonySlotSchema,
} from '@/lib/validation';
import { CEREMONY_SLOTS } from './ceremonySlots';
import type { DetailActionState } from './detailTypes';

/**
 * The five writes behind the event page
 * (docs/specs/2026-08-30-event-detail-design.md §2.2, §6.4).
 *
 * ActionResult is reused from lib/auth/errors rather than redefined: it is a
 * generic {ok} | {ok,formErrors} | {ok,message} shape and a second copy would
 * be a second place for the contract to drift. Its name is the only thing
 * about it that is auth-specific.
 *
 * Every action calls requireUser() FIRST, before parsing. An action is a
 * public HTTP endpoint reachable without ever loading the page, so the page's
 * gate is not its gate (design §3). RLS would hold the line regardless — anon
 * holds no grant on either table — but an unauthenticated caller should be
 * refused before anything else runs.
 *
 * Ownership is NOT pre-checked with a select. Each write passes event_id and
 * lets RLS refuse: one enforcement point rather than two that can disagree.
 * Insert and update are refused by `with check`, which RAISES (42501). Delete
 * has only `using`, which FILTERS: another DJ's delete affects zero rows and
 * returns no error. Both are correct outcomes.
 */

const GENERIC_FAILURE = 'Could not save that. Try again.';

function failure(scope: string, eventId: string, error: { code?: string; message: string }): ActionResult {
  console.error(`${scope}: database error`, { eventId, code: error.code, message: error.message });
  return { ok: false, message: GENERIC_FAILURE };
}

function firstFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const formErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '_form');
    if (!formErrors[key]) formErrors[key] = issue.message;
  }
  return formErrors;
}

export async function addMustPlay(
  _prevState: DetailActionState,
  formData: FormData,
): Promise<ActionResult> {
  await requireUser();

  const parsed = mustPlayAddSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) return { ok: false, formErrors: firstFieldErrors(parsed.error.issues) };

  const { eventId, segment, title, artist, moment } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('event_must_play')
    .insert({ event_id: eventId, segment, title, artist, moment });

  if (error) return failure('addMustPlay', eventId, error);

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

export async function removeMustPlay(formData: FormData): Promise<void> {
  await requireUser();

  const parsed = rowRefSchema.safeParse(formDataToRecord(formData));
  // A malformed remove is not worth a message the user cannot act on: the row
  // is still on screen, and the page re-renders unchanged.
  if (!parsed.success) return;

  const { id, eventId } = parsed.data;
  const supabase = await createClient();
  // Scoped by event_id as well as id: a row id from another of this DJ's own
  // events matches nothing. RLS already stops another DJ's ids.
  const { error } = await supabase
    .from('event_must_play')
    .delete()
    .eq('id', id)
    .eq('event_id', eventId);

  if (error) {
    console.error('removeMustPlay: database error', { eventId, message: error.message });
    return;
  }

  revalidatePath(`/events/${eventId}`);
}

export async function addBlocklistEntry(
  _prevState: DetailActionState,
  formData: FormData,
): Promise<ActionResult> {
  await requireUser();

  const parsed = blocklistAddSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) return { ok: false, formErrors: firstFieldErrors(parsed.error.issues) };

  const { eventId, segment, entryType, value } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('event_blocklist')
    .insert({ event_id: eventId, segment, entry_type: entryType, value });

  if (error) {
    // 23505 is the unique index on (event_id, segment, entry_type, lower(value)).
    // Detected by code rather than by a pre-flight select, which would be a race.
    // A cross-tenant probe cannot reach this: with check is evaluated before
    // index insertion, so it raises 42501 first.
    if (error.code === '23505') {
      return { ok: false, formErrors: { value: 'Already on the do-not-play list.' } };
    }
    return failure('addBlocklistEntry', eventId, error);
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

export async function removeBlocklistEntry(formData: FormData): Promise<void> {
  await requireUser();

  const parsed = rowRefSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) return;

  const { id, eventId } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('event_blocklist')
    .delete()
    .eq('id', id)
    .eq('event_id', eventId);

  if (error) {
    console.error('removeBlocklistEntry: database error', { eventId, message: error.message });
    return;
  }

  revalidatePath(`/events/${eventId}`);
}

/**
 * The ceremony slots and the notes box, saved together by the one "Save
 * changes" button (design §6.4).
 *
 * Each slot is written BY ROW ID, never by upsert: a partial unique index
 * cannot serve as an ON CONFLICT target, and making it a plain constraint
 * would forbid two reception must-plays sharing a moment, which is legitimate.
 *
 * A blank slot title is not a validation error — both slots are empty on a
 * fresh event, and failing here would lose the notes submitted alongside them.
 */
export async function saveEventDetails(
  _prevState: DetailActionState,
  formData: FormData,
): Promise<ActionResult> {
  await requireUser();

  const record = formDataToRecord(formData);
  const parsed = eventDetailsSchema.safeParse(record);
  if (!parsed.success) return { ok: false, formErrors: firstFieldErrors(parsed.error.issues) };

  const { eventId, notes } = parsed.data;
  const supabase = await createClient();

  const { error: notesError } = await supabase
    .from('events')
    .update({ notes })
    .eq('id', eventId);
  if (notesError) return failure('saveEventDetails', eventId, notesError);

  for (const [index, slot] of CEREMONY_SLOTS.entries()) {
    const slotParsed = ceremonySlotSchema.safeParse({
      id: record[`ceremony-${index}-id`] ?? '',
      title: record[`ceremony-${index}-title`] ?? '',
      artist: record[`ceremony-${index}-artist`] ?? '',
    });
    if (!slotParsed.success) {
      return { ok: false, formErrors: firstFieldErrors(slotParsed.error.issues) };
    }

    const { id, title, artist } = slotParsed.data;

    if (id && title) {
      const { error } = await supabase
        .from('event_must_play')
        .update({ title, artist })
        .eq('id', id)
        .eq('event_id', eventId)
        .eq('segment', 'ceremony');
      if (error) return failure('saveEventDetails', eventId, error);
    } else if (id && !title) {
      const { error } = await supabase
        .from('event_must_play')
        .delete()
        .eq('id', id)
        .eq('event_id', eventId)
        .eq('segment', 'ceremony');
      if (error) return failure('saveEventDetails', eventId, error);
    } else if (!id && title) {
      const { error } = await supabase.from('event_must_play').insert({
        event_id: eventId,
        segment: 'ceremony',
        moment: slot.moment,
        title,
        artist,
      });
      if (error) return failure('saveEventDetails', eventId, error);
    }
    // !id && !title: an empty slot that has never been filled. Nothing to do.
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}
