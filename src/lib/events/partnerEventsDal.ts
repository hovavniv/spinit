import 'server-only';

import { cache } from 'react';

import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export interface PartnerEvent {
  id: string;
  couple_names: string;
  event_date: string;
}

/**
 * Every event the signed-in user is a linked PARTNER on (plan task 14).
 *
 * Reads through `event_partners`, so the filter is the caller's RELATIONSHIP
 * to the row, not ownership — the convention `detailDal.ts` records. RLS
 * already admits exactly these rows; `event_partners!inner(...)` plus the
 * `.eq()` on it is a second gate, not the control, the same defense-in-depth
 * `dashboard/dal.ts` applies with `.eq('dj_id', user.id)`.
 *
 * `!inner` rather than a plain embed: a left join would return every event
 * with an empty `event_partners` array attached rather than filtering to
 * just the ones this user is linked on.
 */
export const listPartnerEvents = cache(async (): Promise<PartnerEvent[]> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .select('id, couple_names, event_date, event_partners!inner(user_id)')
    .eq('event_partners.user_id', user.id)
    .order('event_date', { ascending: true })
    .order('id');

  if (error) {
    console.error('listPartnerEvents: failed to load partner events', {
      userId: user.id,
      message: error.message,
    });
    return [];
  }

  // event_partners is selected only to drive the !inner filter above; it
  // carries no data this page renders, so it is stripped rather than typed.
  return (data ?? []).map(({ event_partners: _eventPartners, ...event }) => event as PartnerEvent);
});
