import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { signOut } from '@/lib/auth/actions';
import { getEventForWizard } from '@/lib/events/newEventDal';
import { sendInvites } from '@/lib/events/newEventActions';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { NewEventShell } from '@/components/events/new/NewEventShell';
import { InviteStep } from '@/components/events/new/InviteStep';

export const metadata: Metadata = {
  title: 'Invite the couple — Spinit',
};

export default async function InvitePage({ params }: PageProps<'/events/new/[id]/invite'>) {
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
      <NewEventShell current={2} title={event.couple_names}>
        <InviteStep
          eventId={event.id}
          // A draft created before these columns existed would have nulls. The
          // fallback keeps the label readable rather than rendering an empty
          // possessive.
          partner1Name={event.partner1_name ?? 'Partner 1'}
          partner2Name={event.partner2_name ?? 'Partner 2'}
          partners={event.partners}
          sendAction={sendInvites}
        />
      </NewEventShell>
    </AppShell>
  );
}
