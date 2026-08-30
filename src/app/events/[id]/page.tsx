import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { getEventDetail } from '@/lib/events/detailDal';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { EventDetailScreen } from '@/components/events/detail/EventDetailScreen';

export const metadata: Metadata = {
  title: 'Event — Spinit',
};

/**
 * /events/[id] — the New Event artboard as it renders for an existing event
 * (design §2.1). This is the destination the dashboard's upcoming cards have
 * been pointing at since feat/dashboard-data.
 *
 * requireUser() is called here in the page, not in a layout: Next's own docs
 * warn that a layout check does not re-run on client-side navigation and does
 * not block child segments from rendering (the same reasoning
 * src/app/dashboard/page.tsx records).
 *
 * `params` is a Promise: Next 16 removed synchronous access entirely.
 *
 * notFound() covers BOTH "no such event" and "another DJ's event" — a 403 on
 * the second would confirm the id is real and turn this route into an oracle
 * for enumerating event ids (design §2.5). It throws, so nothing here may wrap
 * it in a try/catch, and it is awaited in the page body rather than inside a
 * <Suspense> child, which would produce a soft 404 (HTTP 200) instead.
 */
export default async function EventPage({ params }: PageProps<'/events/[id]'>) {
  const { id } = await params;

  const user = await requireUser();
  const profile = await getProfile();
  const event = await getEventDetail(id);

  if (!event) notFound();

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    // business_name is nullable and at least one live row is null. Falling
    // back to '' renders an EMPTY chip where the artboard always draws a line,
    // which reads as a broken component rather than as absent data — the same
    // fallback src/app/events/past/page.tsx applies.
    company: profile?.business_name || 'Independent DJ',
  };

  return (
    <AppShell sidebar={<DashboardSidebar dj={dj} current="none" />}>
      <EventDetailScreen event={event} />
    </AppShell>
  );
}
