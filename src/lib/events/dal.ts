import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import type { PastEventRow } from './types';

/**
 * Every completed event of the CURRENT verified DJ, newest first.
 *
 * Takes no id argument, and calls requireUser() itself, so a forgotten
 * requireUser() upstream can never turn this into a way to read another DJ's
 * events — the same shape getProfile uses in src/lib/auth/dal.ts.
 *
 * `.eq('dj_id', user.id)` is defence in depth and NOT the primary control.
 * The primary control is the RLS select policy on public.events, applied
 * through the view's security_invoker; it holds even when application code is
 * wrong, which is what makes it the enforcement boundary. This predicate
 * cannot hold when RLS is wrong. It is here because on a LIST an RLS failure
 * is unbounded — every DJ's events rather than one wrong row — and because
 * getProfile already filters, and two DALs in one repo applying opposite
 * rules is worse than either rule (design §6).
 *
 * The projection is explicit: `.select()` with no argument is `select('*')`,
 * which would also return dj_id and status that nothing renders.
 *
 * The view already filters to status = 'completed', so no status predicate
 * appears here.
 */
export const listPastEvents = cache(async (): Promise<PastEventRow[]> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('past_events_with_counts')
    .select('id, couple_names, venue, event_date, songs_played')
    .eq('dj_id', user.id)
    .order('event_date', { ascending: false })
    // Tiebreaker, not decoration: two events on one date would otherwise come
    // back in an arbitrary order that can differ load to load. (event_date, id)
    // is also the keyset design §10 names for pagination later.
    .order('id', { ascending: false });

  if (error) {
    console.error('listPastEvents: failed to load events', {
      userId: user.id,
      message: error.message,
    });
    return [];
  }

  return data ?? [];
});
