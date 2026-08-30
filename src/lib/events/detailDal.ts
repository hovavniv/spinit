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
    // Both note tables declare `event_id` as PRIMARY KEY and FOREIGN KEY,
    // which is PostgREST's documented condition for detecting a one-to-one
    // relationship: a to-one embed comes back as an OBJECT (`{ body }`), not
    // an array (`[{ body }]`). event_partners' FK is not unique, so it stays
    // to-many and is read as an array below, unchanged.
    //
    // A DJ's read returns the private row; a partner's returns EMPTY
    // (null/undefined), because the policy filters it. That is the boundary
    // working, not an error — do not log it and do not treat it as a failed
    // load. firstRow() normalises either shape so this holds even if the
    // real embed shape (unverifiable until the migration lands) turns out to
    // differ from what's expected here.
    privateNotes: firstRow(data.event_private_notes)?.body ?? '',
    sharedNotes: firstRow(data.event_shared_notes)?.body ?? '',
    partners: data.event_partners ?? [],
    mustPlay: data.event_must_play ?? [],
    blocklist: data.event_blocklist ?? [],
  };
});

/**
 * PostgREST returns a to-MANY embed as an array and a to-ONE embed as an
 * OBJECT. Both note tables declare `event_id` as primary key AND foreign key,
 * which is PostgREST's one-to-one detection condition, so they come back as
 * `{ body }` rather than `[{ body }]`.
 *
 * Reading a to-one embed as an array yields undefined, which defaults to ''.
 * The note then renders blank and the next save upserts that blank over the
 * stored text -- a silent destroy, not merely a silent read failure.
 *
 * Normalised rather than indexed so this holds whichever shape comes back.
 * The migration is not pushed yet, so the real shape cannot be observed here.
 */
function firstRow<T>(embed: T | T[] | null | undefined): T | undefined {
  if (embed == null) return undefined;
  return Array.isArray(embed) ? embed[0] : embed;
}
