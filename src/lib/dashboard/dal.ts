import 'server-only';

import { cache } from 'react';

import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import type { DashboardEventRow, PastEventCountRow } from './fromDb';

// `couple_status` is derived, not selected: it has never been written by
// anything (defaults to 'awaiting-couple' and no application code, trigger
// or function ever sets it — a partner's own session cannot write `events`;
// its UPDATE policy is `auth.uid() = dj_id`). fromDb.ts's coupleStatusOf()
// computes it from these embedded connection rows instead.
const EVENT_COLUMNS =
  'id, couple_names, venue, event_date, status, phase, start_time, event_partners(spotify_connections(status))';
const PAST_COLUMNS = 'id, couple_names, venue, event_date, songs_played';

/**
 * Every event of the signed-in DJ that is upcoming or live — one query
 * serving both the live banner and the upcoming cards, because splitting it
 * would be two round trips for rows that fit in one
 * (docs/specs/2026-08-29-dashboard-data-design.md §5).
 *
 * `.in('status', ['upcoming', 'live'])`, not `.neq('status', 'completed')`:
 * `event_status` also carries `'cancelled'`, which the negated predicate
 * would wrongly admit.
 *
 * `.eq('dj_id', user.id)` is a second gate, not the control: RLS is the
 * control, applied by Postgres to every statement regardless of what the
 * client asks for. The asymmetry is why this predicate exists anyway — RLS
 * holds when application code is wrong, and this predicate cannot hold when
 * RLS is wrong, so it costs nothing and buys a floor under that failure mode
 * (design §5). `requireUser()` is still called first, because a page that
 * renders for an unauthenticated request is a bug even when the query would
 * return nothing.
 */
export const listActiveEvents = cache(async (): Promise<DashboardEventRow[]> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('dj_id', user.id)
    .in('status', ['upcoming', 'live'])
    .order('event_date', { ascending: true });

  if (error) {
    console.error('listActiveEvents: query failed', { message: error.message });
    return [];
  }

  return data as DashboardEventRow[];
});

/**
 * The two most recent completed events, with their played-song counts.
 *
 * Reads `past_events_with_counts`, the view feat/past-events creates. The
 * `.limit(2)` is at the database, not a JavaScript slice: the card shows two
 * rows, and their own `listPastEvents()` is unbounded, so calling it would
 * fetch a DJ's entire history to render two rows. No `.eq('status',
 * 'completed')` here: the view now carries `where e.status = 'completed'`
 * internally, so that filter would be redundant, not protective.
 *
 * `.eq('dj_id', user.id)` matters more here than on `listActiveEvents`: this
 * function reads a **view** owned by `postgres`, which carries
 * `rolbypassrls = true`, and Postgres applies a view's **owner's** policies
 * by default. A later `create or replace view` that omits
 * `security_invoker = on` is valid SQL and would silently return every DJ's
 * completed events to every signed-in DJ. `dj_id` is projected by the view,
 * so this predicate bounds that failure at no cost — RLS is still the
 * control; this cannot substitute for it (design §5).
 */
export const listRecentPastEvents = cache(async (): Promise<PastEventCountRow[]> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('past_events_with_counts')
    .select(PAST_COLUMNS)
    .eq('dj_id', user.id)
    .order('event_date', { ascending: false })
    // Tiebreaker, not decoration: two events on one date would otherwise come
    // back in an arbitrary order that can differ load to load, and because this
    // query also carries a LIMIT, a tie can change WHICH two rows return, not
    // just their order. Same fix as listPastEvents in src/lib/events/dal.ts.
    .order('id', { ascending: false })
    .limit(2);

  if (error) {
    console.error('listRecentPastEvents: query failed', { message: error.message });
    return [];
  }

  return data as PastEventCountRow[];
});
