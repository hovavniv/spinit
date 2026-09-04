import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/validation';
import { formatCardDate } from '@/lib/dashboard/format';
import { startEvent } from '@/lib/live/liveActions';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { PreFlight } from '@/components/live/PreFlight';

export const metadata: Metadata = {
  title: 'Live — Spinit',
};

/**
 * /events/[id]/live — pre-flight before the event starts, the live artboard
 * once it has (design §2, §5.2). This is the route
 * `src/components/dashboard/LiveEventBanner.tsx` has linked to since before
 * this branch existed; it has always 404'd until now.
 *
 * DJ only, never a partner and never another DJ's event — both collapse to
 * the same `dj_id !== user.id` check, since the couple is not admitted to
 * the live queue (§3.6). Never a 403 for any of the refusal cases: a 403
 * confirms the id is real and turns this route into an oracle for
 * enumerating event ids, the same rule `/events/[id]` applies.
 *
 * This does its own minimal read directly against `events` rather than
 * going through `detailDal.ts`'s `getEventDetail` — that file is held by
 * `feat/upcoming-events` this week and its `EventDetail` type does not yet
 * carry `status` (their Task 11), which this route's branching depends on.
 * `liveDal.ts` (task 14) is for the full live screen's reads once the event
 * is live; this pre-flight read is smaller and self-contained on purpose.
 */
export default async function LiveEventPage({ params }: PageProps<'/events/[id]/live'>) {
  const { id } = await params;

  if (!isUuid(id)) notFound();

  const user = await requireUser();
  const profile = await getProfile();

  const supabase = await createClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, dj_id, couple_names, venue, event_date, status, phase, phase_started_at, join_token')
    .eq('id', id)
    .maybeSingle();

  if (!event) notFound();
  if (event.dj_id !== user.id) notFound();
  if (event.status !== 'upcoming' && event.status !== 'live') notFound();

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    company: profile?.business_name || 'Independent DJ',
  };

  return (
    <AppShell sidebar={<DashboardSidebar dj={dj} current="none" />}>
      {event.status === 'upcoming' ? (
        <PreFlight
          eventId={event.id}
          coupleNames={event.couple_names}
          venue={event.venue}
          eventDate={formatCardDate(event.event_date)}
          startEvent={startEvent}
        />
      ) : (
        // Placeholder for the live artboard, built in Task 16
        // (src/components/live/LiveScreen.tsx). Deliberately not a separate
        // component yet: Task 16 replaces this branch's content directly
        // rather than wiring a component that doesn't exist until then.
        <p>The event is live.</p>
      )}
    </AppShell>
  );
}
