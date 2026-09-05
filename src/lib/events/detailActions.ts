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
  endEventSchema,
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
 * and guard-filtered update have only `using`, which FILTERS: the statement
 * affects zero rows and returns NO error. That is not treated as success —
 * every remove and update here appends `.select()` and reports a zero-row
 * result as a failure, because a caller who is told "saved" when nothing was
 * written has been lied to. The one deliberate no-op is the never-filled
 * ceremony slot below, whose comment says why.
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

  const { eventId, segment, title, artist, moment, spotifyTrackId, spotifyArtistId } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('event_must_play')
    .insert({
      event_id: eventId,
      segment,
      title,
      artist,
      moment,
      spotify_track_id: spotifyTrackId,
      spotify_artist_id: spotifyArtistId ? spotifyArtistId : null,
    });

  if (error) return failure('addMustPlay', eventId, error);

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

export async function removeMustPlay(formData: FormData): Promise<ActionResult> {
  await requireUser();

  const parsed = rowRefSchema.safeParse(formDataToRecord(formData));
  // A malformed remove is not worth a message the user cannot act on: the row
  // is still on screen, and the page re-renders unchanged.
  if (!parsed.success) return { ok: false, message: GENERIC_FAILURE };

  const { id, eventId } = parsed.data;
  const supabase = await createClient();
  // Scoped by event_id as well as id: a row id from another of this DJ's own
  // events matches nothing. RLS already stops another DJ's ids.
  //
  // .select() turns this back into a row check: a policy-filtered or
  // nonexistent id/eventId match still returns success having deleted
  // nothing -- the repo's documented silent-zero-row shape (see CLAUDE.md;
  // saveEventDetails' own delete branch already guards against exactly this).
  const { data: deleted, error } = await supabase
    .from('event_must_play')
    .delete()
    .eq('id', id)
    .eq('event_id', eventId)
    .select();

  if (error) return failure('removeMustPlay', eventId, error);
  if (!deleted || deleted.length === 0) {
    return failure('removeMustPlay', eventId, { message: 'delete matched zero rows' });
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

export async function addBlocklistEntry(
  _prevState: DetailActionState,
  formData: FormData,
): Promise<ActionResult> {
  await requireUser();

  const parsed = blocklistAddSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) return { ok: false, formErrors: firstFieldErrors(parsed.error.issues) };

  const { eventId, segment, entryType, value, spotifyId } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('event_blocklist')
    .insert({
      event_id: eventId,
      segment,
      entry_type: entryType,
      value,
      // Mirrors the database's blocklist_id_matches_type check constraint:
      // a genre entry has no Spotify identity, an artist or song always does
      // (the schema already refused this combination if it were otherwise).
      spotify_id: entryType === 'genre' ? null : (spotifyId ?? null),
    });

  if (error) {
    // 23505 is one of the two partial unique indexes on event_blocklist:
    //   event_blocklist_spotify_idx  (event_id, segment, entry_type, spotify_id)
    //   event_blocklist_genre_idx    (event_id, segment, lower(value))
    // -- two identity schemes for two genuinely different kinds of entry.
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

export async function removeBlocklistEntry(formData: FormData): Promise<ActionResult> {
  await requireUser();

  const parsed = rowRefSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) return { ok: false, message: GENERIC_FAILURE };

  const { id, eventId } = parsed.data;
  const supabase = await createClient();
  // Same silent-zero-row guard as removeMustPlay, and for the same reason:
  // a policy-filtered or nonexistent delete otherwise returns success having
  // deleted nothing.
  const { data: deleted, error } = await supabase
    .from('event_blocklist')
    .delete()
    .eq('id', id)
    .eq('event_id', eventId)
    .select();

  if (error) return failure('removeBlocklistEntry', eventId, error);
  if (!deleted || deleted.length === 0) {
    return failure('removeBlocklistEntry', eventId, { message: 'delete matched zero rows' });
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

/**
 * The ceremony slots, saved by the one "Save changes" button (design §6.4).
 *
 * Each slot is written BY ROW ID, never by upsert: a partial unique index
 * cannot serve as an ON CONFLICT target, and making it a plain constraint
 * would forbid two reception must-plays sharing a moment, which is legitimate.
 *
 * A blank slot title is not a validation error — both slots are empty on a
 * fresh event, and failing here would reject the whole submission over a
 * field the DJ deliberately left empty.
 */
export async function saveEventDetails(
  _prevState: DetailActionState,
  formData: FormData,
): Promise<ActionResult> {
  await requireUser();

  const record = formDataToRecord(formData);
  const parsed = eventDetailsSchema.safeParse(record);
  if (!parsed.success) return { ok: false, formErrors: firstFieldErrors(parsed.error.issues) };

  const { eventId } = parsed.data;
  const supabase = await createClient();

  // Notes moved to their own tables and their own actions (design §3). Writing
  // events.notes here alongside the ceremony rows produced a half-success for a
  // partner: events UPDATE is DJ-only and filters to zero rows WITHOUT erroring,
  // so the ceremony song saved, the notes vanished, and the screen said "Saved".

  for (const [index, slot] of CEREMONY_SLOTS.entries()) {
    const slotParsed = ceremonySlotSchema.safeParse({
      id: record[`ceremony-${index}-id`] ?? '',
      title: record[`ceremony-${index}-title`] ?? '',
      artist: record[`ceremony-${index}-artist`] ?? '',
      spotifyTrackId: record[`ceremony-${index}-spotifyTrackId`] ?? '',
      spotifyArtistId: record[`ceremony-${index}-spotifyArtistId`] ?? '',
    });
    if (!slotParsed.success) {
      return { ok: false, formErrors: firstFieldErrors(slotParsed.error.issues) };
    }

    const { id, title, artist, spotifyTrackId, spotifyArtistId } = slotParsed.data;
    const spotifyArtistIdOrNull = spotifyArtistId ? spotifyArtistId : null;

    if (id && title) {
      // .select() turns this back into a row check: a policy-filtered or
      // nonexistent id/eventId/segment combination would otherwise match zero
      // rows and Postgres would still report success -- the repo's documented
      // silent-zero-row shape (see CLAUDE.md).
      //
      // spotify_track_id/spotify_artist_id are written on this branch too, not
      // just title/artist: leaving them out would let a DJ pick a different
      // song here and have the title change while the id stays pointed at the
      // ORIGINAL pick -- display text and identity silently diverging, with
      // the decision engine later reasoning about a track nobody chose.
      const { data: updated, error } = await supabase
        .from('event_must_play')
        .update({
          title,
          artist,
          spotify_track_id: spotifyTrackId,
          spotify_artist_id: spotifyArtistIdOrNull,
        })
        .eq('id', id)
        .eq('event_id', eventId)
        .eq('segment', 'ceremony')
        .select();
      if (error) return failure('saveEventDetails', eventId, error);
      if (!updated || updated.length === 0) {
        return failure('saveEventDetails', eventId, {
          message: 'update matched zero rows',
        });
      }
    } else if (id && !title) {
      const { data: deleted, error } = await supabase
        .from('event_must_play')
        .delete()
        .eq('id', id)
        .eq('event_id', eventId)
        .eq('segment', 'ceremony')
        .select();
      if (error) return failure('saveEventDetails', eventId, error);
      if (!deleted || deleted.length === 0) {
        return failure('saveEventDetails', eventId, {
          message: 'delete matched zero rows',
        });
      }
    } else if (!id && title) {
      const { error } = await supabase.from('event_must_play').insert({
        event_id: eventId,
        segment: 'ceremony',
        moment: slot.moment,
        title,
        artist,
        spotify_track_id: spotifyTrackId,
        spotify_artist_id: spotifyArtistIdOrNull,
      });
      if (error) return failure('saveEventDetails', eventId, error);
    }
    // !id && !title: an empty slot that has never been filled. Nothing to do.
    // If every slot takes this branch the loop issues no statement at all and
    // this still returns { ok: true } -- deliberate, not the silent-zero-row
    // bug the .select() checks above guard against. There is nothing to save,
    // and it is not an information leak: a caller who cannot reach this event
    // at all is turned away before the page even renders (getEventDetail
    // returns null for a non-participant, design §2.5), so a legitimately
    // empty slot and an unreachable event are never distinguishable from this
    // response either way. Do not "fix" this into a failure.
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

/**
 * Ends an event: the only code in this application that writes
 * `status = 'completed'` (design §3.6).
 *
 * The status filter is a transition guard, not decoration. The UPDATE grant on
 * public.events is TABLE-level and the `dj updates own events` policy scopes
 * which ROWS a DJ may write, not which VALUES — so without it this endpoint
 * would resurrect a completed event or promote a draft straight past the
 * wizard. It admits 'live' because a live event is exempt from the date rule
 * and this button is the only thing that can end one.
 *
 * `.select()` and the zero-row check follow the other removes and updates in
 * this file: a policy-filtered or guard-refused write affects zero rows and
 * returns no error, and reporting that as success would tell a DJ their
 * wedding was closed out when nothing happened.
 *
 * Ownership is not pre-checked with a select; RLS refuses. One enforcement
 * point rather than two that can disagree.
 *
 * ONE ARGUMENT, matching removeMustPlay and removeBlocklistEntry in this file.
 * Nothing supplies a prevState here — no useActionState wraps the control — and
 * the two-argument shape would need a second exported wrapper purely to strip
 * it before a Server Component could pass this to a client component. That is
 * an extra endpoint on a 'use server' module bought for nothing.
 */
export async function endEvent(formData: FormData): Promise<ActionResult> {
  await requireUser();

  const parsed = endEventSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) return { ok: false, formErrors: firstFieldErrors(parsed.error.issues) };

  const { eventId } = parsed.data;
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from('events')
    .update({ status: 'completed' })
    .eq('id', eventId)
    .in('status', ['upcoming', 'live'])
    .select();

  if (error) return failure('endEvent', eventId, error);
  if (!updated || updated.length === 0) {
    return failure('endEvent', eventId, { message: 'end matched zero rows' });
  }

  // The four places this row's membership just changed.
  revalidatePath(`/events/${eventId}`);
  revalidatePath('/events/upcoming');
  revalidatePath('/events/past');
  revalidatePath('/dashboard');
  return { ok: true };
}
