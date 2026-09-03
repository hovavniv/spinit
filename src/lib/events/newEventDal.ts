import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { isUuid } from '@/lib/validation';
import type { WizardEvent, WizardPartner } from './newEventTypes';

/** The row shape PostgREST returns for the select below. */
interface WizardRow {
  id: string;
  couple_names: string;
  partner1_name: string | null;
  partner2_name: string | null;
  event_date: string;
  venue: string;
  guest_count: number | null;
  status: 'draft' | 'upcoming';
  event_partners: WizardPartner[] | null;
}

/**
 * The one read behind all four wizard routes
 * (docs/specs/2026-09-02-new-event-design.md §6.1).
 *
 * Calls requireUser() itself, the shape listPastEvents and getProfile already
 * use, so a forgotten requireUser() upstream can never turn this into a way to
 * read another DJ's event.
 *
 * `.eq('dj_id', user.id)` is defence in depth and NOT the primary control --
 * the RLS select policy on public.events is. Written for consistency with
 * lib/events/dal.ts, because two DALs in one repo applying opposite rules is
 * worse than either rule.
 *
 * `.in('status', ['draft','upcoming'])` IS load-bearing, and is not defence in
 * depth: RLS scopes rows to their owning DJ and says nothing about status.
 * Without it the wizard is a working editor for any event this DJ owns, and
 * `Continue` would silently rewrite the couple's names, venue and date on a
 * recap that has already been delivered (design §2.3).
 *
 * The embedded partner rows are ORDERED. Both are written by one statement, so
 * their created_at is byte-identical -- now() is transaction start time, not
 * per-row wall-clock -- and PostgREST returns tied rows in whatever order the
 * executor picks. Callers additionally index by `slot` rather than by array
 * position, so this is belt and braces rather than the only defence.
 *
 * Errors return null rather than throwing: every caller turns null into
 * notFound(), and a degraded wizard step is a 404, not a 500.
 */
export const getEventForWizard = cache(async (id: string): Promise<WizardEvent | null> => {
  if (!isUuid(id)) return null;

  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .select(
      `id, couple_names, partner1_name, partner2_name, event_date, venue, guest_count, status,
       event_partners (slot, display_name, invite_email)`,
    )
    .eq('id', id)
    .eq('dj_id', user.id)
    .in('status', ['draft', 'upcoming'])
    .order('slot', { referencedTable: 'event_partners', ascending: true })
    .maybeSingle();

  if (error) {
    console.error('getEventForWizard: failed to load the event', {
      eventId: id,
      userId: user.id,
      message: error.message,
    });
    return null;
  }

  if (!data) return null;

  const row = data as unknown as WizardRow;

  return {
    id: row.id,
    couple_names: row.couple_names,
    partner1_name: row.partner1_name,
    partner2_name: row.partner2_name,
    event_date: row.event_date,
    venue: row.venue,
    guest_count: row.guest_count,
    status: row.status,
    partners: row.event_partners ?? [],
  };
});
