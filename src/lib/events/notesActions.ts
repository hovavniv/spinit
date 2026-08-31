'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import type { ActionResult } from '@/lib/auth/errors';
import { formDataToRecord, privateNotesSchema, sharedNotesSchema } from '@/lib/validation';
import type { DetailActionState } from './detailTypes';

/* ---------------------------------------------------------------------------
   The two note writes (design §3, §5.2).

   UPSERT, not UPDATE. The migration backfills a row per event so an update
   would work today, but an event created after this migration would have no
   row, and an update matching no row returns SUCCESS having written nothing --
   the silent zero-row write this repo has now hit three times. The upsert
   makes that unreachable rather than merely unlikely.

   Two actions, not one, because the two tables have different policies: the
   private one admits only the DJ, the shared one admits both partners too. One
   action writing both would half-succeed for a partner -- the shared row
   saved, the private write filtered to zero rows WITHOUT erroring -- and
   report ok.

   requireUser() runs FIRST, before parsing. A server action is a public HTTP
   endpoint reachable without ever loading the page, so the page's gate is not
   its gate. RLS is still the boundary; this is the cheap check in front of it.
   --------------------------------------------------------------------------- */

const GENERIC_FAILURE = 'Could not save that. Try again.';

async function saveNotes(
  table: 'event_private_notes' | 'event_shared_notes',
  schema: typeof privateNotesSchema,
  formData: FormData,
): Promise<ActionResult> {
  await requireUser();

  const parsed = schema.safeParse(formDataToRecord(formData));
  if (!parsed.success) {
    const formErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (!(key in formErrors)) formErrors[key] = issue.message;
    }
    return { ok: false, formErrors };
  }

  const { eventId, body } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from(table)
    .upsert({ event_id: eventId, body }, { onConflict: 'event_id' });

  if (error) {
    // The code and message go to the server log, never to the caller: a
    // 42501 tells an attacker their guess at an event id was real.
    console.error(`${table}: database error`, {
      eventId,
      code: error.code,
      message: error.message,
    });
    return { ok: false, message: GENERIC_FAILURE };
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

export async function savePrivateNotes(
  _prevState: DetailActionState,
  formData: FormData,
): Promise<ActionResult> {
  return saveNotes('event_private_notes', privateNotesSchema, formData);
}

export async function saveSharedNotes(
  _prevState: DetailActionState,
  formData: FormData,
): Promise<ActionResult> {
  return saveNotes('event_shared_notes', sharedNotesSchema, formData);
}
