import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { signOut } from '@/lib/auth/actions';
import { getEventForWizard } from '@/lib/events/newEventDal';
import { saveEventDraft } from '@/lib/events/newEventActions';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { NewEventShell } from '@/components/events/new/NewEventShell';
import { EventDetailsStep } from '@/components/events/new/EventDetailsStep';

export const metadata: Metadata = {
  title: 'Event details — Spinit',
};

/**
 * Step 1 in edit mode — the target of step 2's "← Back", so a DJ can fix a
 * typo without starting a second draft.
 *
 * notFound() covers "no such event", "another DJ's event" and "an event past
 * upcoming" identically: a 403 on any of them would confirm the id is real and
 * turn this route into a way to enumerate event ids. getEventForWizard's own
 * status predicate is what refuses a live or completed event (design §2.3).
 *
 * `params` is a Promise: Next in this repo removed synchronous access.
 */
export default async function EditDraftPage({ params }: PageProps<'/events/new/[id]'>) {
  const { id } = await params;

  const user = await requireUser();
  const profile = await getProfile();
  const event = await getEventForWizard(id);

  if (!event) notFound();

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    company: profile?.business_name || 'Independent DJ',
  };

  return (
    <AppShell sidebar={<DashboardSidebar dj={dj} current="none" signOutAction={signOut} />}>
      <NewEventShell current={1} title={event.couple_names}>
        <EventDetailsStep event={event} saveAction={saveEventDraft} />
      </NewEventShell>
    </AppShell>
  );
}
