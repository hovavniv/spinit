import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { getEventDetail } from '@/lib/events/detailDal';
import { resolveViewer } from '@/lib/events/viewer';
import { isUuid } from '@/lib/validation';
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
 * notFound() covers "no such event", "another DJ's event" and "an event you
 * neither run nor are a partner on" — a 403 on any of them would confirm the
 * id is real and turn this route into an oracle for enumerating event ids
 * (design §2.5, §4). It throws, so nothing here may wrap
 * it in a try/catch, and it is awaited in the page body rather than inside a
 * <Suspense> child, which would produce a soft 404 (HTTP 200) instead.
 *
 * `id` is checked against the uuid shape BEFORE it ever reaches getEventDetail:
 * a non-uuid segment (e.g. the sidebar's still-present /events/upcoming link,
 * or a crawler) would otherwise reach Postgres and fail with `22P02 invalid
 * input syntax for type uuid`, logged as if it were a genuine DB failure. The
 * 404 is identical either way; this just keeps that path quiet. `isUuid`
 * (`@/lib/validation`) is shared with `getEventRecap` in
 * `@/lib/events/dal.ts`, which guards its own non-uuid ids the same way.
 */
export default async function EventPage({ params }: PageProps<'/events/[id]'>) {
  const { id } = await params;

  if (!isUuid(id)) notFound();

  const user = await requireUser();
  const profile = await getProfile();
  const event = await getEventDetail(id);

  if (!event) notFound();

  // notFound() for a non-participant, never a 403 -- a 403 would confirm the
  // id is real and turn this route into an oracle for enumerating event ids
  // (design §4). RLS has already decided what this user can READ; this only
  // decides what the page draws, and refuses to draw anything for someone who
  // is neither the DJ nor a linked partner.
  const viewer = resolveViewer(user.id, event.dj_id, event.partners);

  if (!viewer) notFound();

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    // business_name is nullable and at least one live row is null. Falling
    // back to '' renders an EMPTY chip where the artboard always draws a line,
    // which reads as a broken component rather than as absent data — the same
    // fallback src/app/events/past/page.tsx applies.
    company: profile?.business_name || 'Independent DJ',
  };

  return (
    <AppShell sidebar={<DashboardSidebar dj={dj} current="none" hideNav={viewer.role === 'partner'} />}>
      <EventDetailScreen event={event} viewer={viewer} />
    </AppShell>
  );
}
