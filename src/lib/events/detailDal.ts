import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import type { EventDetail } from './detailTypes';

/**
 * One event of the CURRENT verified DJ, with both song lists, or null.
 *
 * Null means BOTH "no such event" and "not yours" — deliberately
 * indistinguishable, so the route cannot be used to test whether an id exists
 * (design §2.5). The page turns either into notFound().
 *
 * One request, not three: the two lists come back as embedded resources, so
 * Postgres resolves the join and the client waits once (design §2.6).
 *
 * `.eq('dj_id', …)` is defence in depth and NOT the primary control. The
 * primary control is the RLS select policy on public.events and the
 * event-owner predicate on the two child tables; it holds even when
 * application code is wrong, which is what makes it the boundary. This
 * predicate cannot hold when RLS is wrong. It is here because listPastEvents
 * already filters, and two DALs in one repo applying opposite rules is worse
 * than either rule.
 *
 * `maybeSingle()`, not `single()`: zero rows is an expected outcome here, not
 * an error worth logging.
 *
 * The embeds are ordered at PostgREST rather than sorted in JavaScript
 * afterwards — that is what makes the (event_id, segment, created_at) indexes
 * earn their tail. `venue` is deliberately not selected: nothing on this page
 * draws it, and selecting a column no component reads is the over-fetch this
 * design argues against.
 */
export const getEventDetail = cache(async (eventId: string): Promise<EventDetail | null> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .select(
      `id, couple_names, event_date, couple_status, notes,
       event_must_play (id, segment, title, artist, moment, created_at),
       event_blocklist (id, segment, entry_type, value, created_at)`,
    )
    .eq('id', eventId)
    .eq('dj_id', user.id)
    .order('created_at', { referencedTable: 'event_must_play', ascending: true })
    .order('created_at', { referencedTable: 'event_blocklist', ascending: true })
    .maybeSingle();

  if (error) {
    console.error('getEventDetail: failed to load event', {
      userId: user.id,
      eventId,
      message: error.message,
    });
    return null;
  }

  if (!data) return null;

  return {
    id: data.id,
    couple_names: data.couple_names,
    event_date: data.event_date,
    couple_status: data.couple_status,
    notes: data.notes,
    mustPlay: data.event_must_play ?? [],
    blocklist: data.event_blocklist ?? [],
  };
});
