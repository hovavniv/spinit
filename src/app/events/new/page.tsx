import type { Metadata } from 'next';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { signOut } from '@/lib/auth/actions';
import { saveEventDraft } from '@/lib/events/newEventActions';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { NewEventShell } from '@/components/events/new/NewEventShell';
import { EventDetailsStep } from '@/components/events/new/EventDetailsStep';

export const metadata: Metadata = {
  title: 'New event — Spinit',
};

/**
 * Step 1 in create mode — the destination the dashboard's "+ New event" button
 * has pointed at since feat/dashboard-data, and which 404'd until now.
 *
 * requireUser() is called here in the page, not in a layout: Next's own docs
 * warn that a layout check does not re-run on client-side navigation and does
 * not block child segments from rendering.
 */
export default async function NewEventPage() {
  const user = await requireUser();
  const profile = await getProfile();

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    company: profile?.business_name || 'Independent DJ',
  };

  return (
    <AppShell sidebar={<DashboardSidebar dj={dj} current="none" signOutAction={signOut} />}>
      <NewEventShell current={1} title="New event">
        <EventDetailsStep event={null} saveAction={saveEventDraft} />
      </NewEventShell>
    </AppShell>
  );
}
