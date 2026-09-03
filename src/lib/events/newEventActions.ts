'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import type { ActionResult } from '@/lib/auth/errors';
import { formDataToRecord, eventDraftSchema, partnerInviteSchema } from '@/lib/validation';
import { composeCoupleNames } from './coupleNames';
import type { WizardActionState } from './newEventTypes';

/**
 * The three writes behind the New Event wizard
 * (docs/specs/2026-09-02-new-event-design.md §5).
 *
 * Every action calls requireUser() FIRST, before parsing. An action is a public
 * HTTP endpoint reachable without ever loading the page, so the page's gate is
 * not its gate.
 *
 * Ownership is NOT pre-checked with a select. Each write passes the id and lets
 * RLS refuse: one enforcement point rather than two that can disagree. This is
 * the rule detailActions.ts already records.
 */

const GENERIC_FAILURE = 'Could not save that. Try again.';

/**
 * Mirrors detailActions.ts's helper deliberately, including logging
 * `error.message`. A server log is not something the client sees, and the
 * message is what makes a check-constraint violation debuggable. The
 * "code only, never the message" rule belongs to partnersDal.ts, where the
 * CLAIM must be indistinguishable across three different failures, and it does
 * not generalise (design §7).
 */
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

export async function saveEventDraft(
  _prevState: WizardActionState,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = eventDraftSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) return { ok: false, formErrors: firstFieldErrors(parsed.error.issues) };

  const { eventId, partner1Name, partner2Name, eventDate, venue, guestCount } = parsed.data;
  const supabase = await createClient();

  // The five columns both branches write. status is deliberately absent.
  const details = {
    couple_names: composeCoupleNames(partner1Name, partner2Name),
    partner1_name: partner1Name,
    partner2_name: partner2Name,
    event_date: eventDate,
    venue,
    guest_count: guestCount,
  };

  let id = eventId;

  if (eventId === '') {
    const { data, error } = await supabase
      .from('events')
      .insert({ ...details, dj_id: user.id, status: 'draft' })
      .select('id')
      .maybeSingle();

    if (error) return failure('saveEventDraft', '(new)', error);
    if (!data) return { ok: false, message: GENERIC_FAILURE };

    id = (data as { id: string }).id;
  } else {
    // No status key, and a status predicate: see §2.3. A zero-row update here
    // means the event moved past `upcoming` between the page render and the
    // submit, which the redirect below resolves by sending the DJ to a route
    // that will then 404 or forward them.
    const { error } = await supabase
      .from('events')
      .update(details)
      .eq('id', eventId)
      .in('status', ['draft', 'upcoming']);

    if (error) return failure('saveEventDraft', eventId, error);
  }

  revalidatePath('/dashboard');

  // redirect() throws internally -- expected Next behaviour. It is called
  // after the write and outside any try/catch, as signInWithPassword does.
  redirect(`/events/new/${id}/invite`);
}

/**
 * Step 2's write (design §5.2). THREE statements, deliberately — read the
 * comment on statement 1 before changing any of them.
 *
 * The partner names come from events.partner1_name/partner2_name, not from the
 * form: step 1 collected them, and the artboard's step 2 has no name fields.
 */
export async function sendInvites(
  _prevState: WizardActionState,
  formData: FormData,
): Promise<ActionResult> {
  await requireUser();

  const parsed = partnerInviteSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) return { ok: false, formErrors: firstFieldErrors(parsed.error.issues) };

  const { eventId, email1, email2 } = parsed.data;

  // Imported here rather than at the top: newEventDal.ts carries
  // `import 'server-only'`, which is fine in this 'use server' module, and
  // keeping the import beside its use documents why the read is needed.
  const { getEventForWizard } = await import('./newEventDal');
  const event = await getEventForWizard(eventId);
  if (!event) return { ok: false, message: GENERIC_FAILURE };

  const supabase = await createClient();

  const rows = [
    {
      event_id: eventId,
      slot: 1,
      display_name: event.partner1_name ?? 'Partner 1',
      invite_email: email1,
    },
    {
      event_id: eventId,
      slot: 2,
      display_name: event.partner2_name ?? 'Partner 2',
      invite_email: email2,
    },
  ];

  // 1. Make sure both rows exist. ON CONFLICT DO NOTHING -- NEVER DO UPDATE.
  //
  // event_partners' update grant is column-scoped and excludes event_id on
  // purpose (that exclusion is what stops a row being re-parented onto another
  // DJ's event). PostgREST compiles an upsert to
  // `ON CONFLICT DO UPDATE SET <every column in the payload>`, and this payload
  // necessarily carries event_id, so `ignoreDuplicates: false` would fail 42501
  // on the SECOND run of this action. The migration says so in place, in
  // capitals. scripts/seed-demo.mjs uses this same call shape.
  //
  // One statement for both rows, so it cannot half-apply.
  const { error: insertError } = await supabase
    .from('event_partners')
    .upsert(rows, { onConflict: 'event_id,slot', ignoreDuplicates: true });

  if (insertError) return failure('sendInvites', eventId, insertError);

  // 2. Apply the current values. Statement 1 deliberately ignores existing
  // rows, so without this a DJ correcting a typo would change nothing. Only
  // the two granted columns are written.
  for (const row of rows) {
    const { error: updateError } = await supabase
      .from('event_partners')
      .update({ display_name: row.display_name, invite_email: row.invite_email })
      .eq('event_id', eventId)
      .eq('slot', row.slot);

    if (updateError) return failure('sendInvites', eventId, updateError);
  }

  // 3. Promote ONLY a draft. Without the status predicate, opening this URL on
  // a finished wedding drags a completed event back to 'upcoming' and it
  // reappears on the dashboard. A zero-row result here is the CORRECT outcome
  // for an already-promoted event, not an error, so it is not treated as one.
  const { error: promoteError } = await supabase
    .from('events')
    .update({ status: 'upcoming' })
    .eq('id', eventId)
    .eq('status', 'draft');

  if (promoteError) return failure('sendInvites', eventId, promoteError);

  revalidatePath('/dashboard');
  redirect(`/events/new/${eventId}/sent`);
}
