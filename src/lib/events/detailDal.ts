import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import type { EventDetail } from './detailTypes';

/**
 * One event the CURRENT verified user PARTICIPATES IN — as its DJ or as a
 * linked partner — with both song lists, both note bodies and the partner
 * rows, or null.
 *
 * Null means BOTH "no such event" and "not yours" — deliberately
 * indistinguishable, so the route cannot be used to test whether an id exists
 * (design §2.5). The page turns either into notFound().
 *
 * One request, not five: the lists, the notes and the partners all come back
 * as embedded resources, so Postgres resolves the joins and the client waits
 * once (design §2.6).
 *
 * The DAL filters by the caller's RELATIONSHIP to the row, not by ownership.
 * Where ownership is the relationship, the filter stays .eq('dj_id', user.id) —
 * getEventRecap and every dashboard read still do. Here the relationship is
 * participation, so the filter is the event id and RLS remains the control
 * (design §6.2). Two DALs applying opposite rules for no stated reason is worse
 * than either rule; this is the stated reason.
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
      `id, dj_id, couple_names, couple_status,
       event_partners (id, slot, display_name, user_id),
       event_private_notes (body),
       event_shared_notes (body),
       event_must_play (id, segment, title, artist, moment, created_at),
       event_blocklist (id, segment, entry_type, value, created_at)`,
    )
    .eq('id', eventId)
    .order('slot', { referencedTable: 'event_partners', ascending: true })
    .order('created_at', { referencedTable: 'event_must_play', ascending: true })
    .order('id', { referencedTable: 'event_must_play', ascending: true })
    .order('created_at', { referencedTable: 'event_blocklist', ascending: true })
    .order('id', { referencedTable: 'event_blocklist', ascending: true })
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
    dj_id: data.dj_id,
    couple_names: data.couple_names,
    couple_status: data.couple_status,
    // PostgREST returns every embed as an array, even a one-to-one. A DJ's
    // read returns the private row; a partner's returns an EMPTY ARRAY,
    // because the policy filters it. That is the boundary working, not an
    // error — do not log it and do not treat it as a failed load.
    privateNotes: data.event_private_notes?.[0]?.body ?? '',
    sharedNotes: data.event_shared_notes?.[0]?.body ?? '',
    partners: data.event_partners ?? [],
    mustPlay: data.event_must_play ?? [],
    blocklist: data.event_blocklist ?? [],
  };
});
