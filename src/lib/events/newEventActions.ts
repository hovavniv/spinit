'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import type { ActionResult } from '@/lib/auth/errors';
import { formDataToRecord, eventDraftSchema } from '@/lib/validation';
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
