import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { isUuid } from '@/lib/validation';
import type { PastEventRow, EventRecap } from './types';

/**
 * Every ended event of the CURRENT verified DJ, newest first — completed, or
 * date-passed (see `20260904120000_ended_events_view.sql`).
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
 * The view carries its own `ended` predicate — `status = 'completed'` OR an
 * `upcoming` event whose date has passed — so no status predicate appears
 * here.
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

/**
 * One ended event the CURRENT verified user PARTICIPATES IN -- as its DJ or
 * as a linked partner -- with its playlist in order. Returns null for
 * anything this user may not see.
 *
 * Calls requireUser() itself for the same reason listPastEvents does: a
 * forgotten requireUser() upstream must not be able to turn this into a way to
 * read another event.
 *
 * FOUR CASES COLLAPSE INTO null, deliberately (design §4.2, §15.4): a
 * malformed id, a nonexistent event, an event this user does not participate
 * in, and an event that has not ended. The page turns all four into the same
 * notFound(), so the route cannot be used to probe which event ids exist.
 * Under the couple-facing recap (§15) that indistinguishability holds across
 * TWO roles, not one -- a DJ probing an id they do not own, a partner
 * probing an id they are not on, and a partner probing an event that IS
 * theirs but has not ended yet all produce the identical null. The third is
 * the easy one to lose, because it is the only case where the caller
 * genuinely is entitled to the row and is being refused on state rather than
 * on identity.
 *
 * No ownership predicate here, deliberately (design §15.4) -- the same move
 * getEventDetail already made, for the same reason it records: "The DAL
 * filters by the caller's RELATIONSHIP to the row, not by ownership. Where
 * ownership is the relationship, the filter stays .eq('dj_id', user.id)...
 * Here the relationship is participation." RLS is the primary control: the
 * events select policy (`dj_id = auth.uid() OR is_event_partner(id)`, since
 * 20260831090000) reaches this view through its `security_invoker` setting,
 * so a non-participant's row is filtered out before this function ever sees
 * it -- and the "not ended yet" case collapses to null for free, because
 * `past_events_with_counts` only lists ended events in the first place.
 *
 * The second query ALSO carries no owner predicate, and now correctly so:
 * `played_songs`' select policy is `dj or partner selects songs of event`
 * (§15.3, this branch's migration) -- a partner is admitted to the songs of
 * an event they participate in, the same relationship the first query
 * already established. (An earlier version of this comment said "the first
 * query has already established ownership"; participation is the accurate
 * word now that a partner can reach this function at all.)
 *
 * ERRORS THROW, they are not swallowed into null (design §8). listPastEvents
 * returns [] on error because a degraded list is still a list. Here, returning
 * null would tell a participant that a wedding they know happened does not
 * exist, with no retry offered. Throwing reaches src/app/error.tsx, which has
 * one.
 */
export const getEventRecap = cache(async (id: string): Promise<EventRecap | null> => {
  // Before any query: `where id = 'banana'` raises 22P02 in Postgres, which
  // would surface as a 500 where a 404 belongs.
  if (!isUuid(id)) return null;

  const user = await requireUser();
  const supabase = await createClient();

  const { data: event, error: eventError } = await supabase
    // The view, not the table: it already encodes "ended" (completed, or
    // upcoming with a past date), so this function does not write that rule a
    // second time. It projects every column selected here, dj_id included.
    .from('past_events_with_counts')
    .select('id, couple_names, venue, event_date')
    .eq('id', id)
    .maybeSingle();

  if (eventError) {
    console.error('getEventRecap: failed to load the event', {
      eventId: id,
      userId: user.id,
      message: eventError.message,
    });
    throw new Error('getEventRecap: could not load the event');
  }

  if (!event) return null;

  // position carries `unique (event_id, position)` and `check (position > 0)`,
  // so within one event this is a total order and needs no tiebreaker --
  // unlike listPastEvents, where two events can share a date.
  const { data: songs, error: songsError } = await supabase
    .from('played_songs')
    .select('position, title, artist, suggested_by')
    .eq('event_id', id)
    .order('position', { ascending: true });

  if (songsError) {
    console.error('getEventRecap: failed to load the playlist', {
      eventId: id,
      userId: user.id,
      message: songsError.message,
    });
    throw new Error('getEventRecap: could not load the playlist');
  }

  // An event with no songs is a valid recap, not an error (design §7.4).
  return { event, songs: songs ?? [] };
});
