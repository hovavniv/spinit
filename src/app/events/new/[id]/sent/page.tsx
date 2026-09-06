import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { signOut } from '@/lib/auth/actions';
import { getEventForWizard } from '@/lib/events/newEventDal';
import { siteUrl } from '@/lib/auth/site-url';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { NewEventShell } from '@/components/events/new/NewEventShell';
import { InviteSent } from '@/components/events/new/InviteSent';

export const metadata: Metadata = {
  title: 'Links ready — Spinit',
};

export default async function SentPage({ params }: PageProps<'/events/new/[id]/sent'>) {
  const { id } = await params;

  const user = await requireUser();
  const profile = await getProfile();
  const event = await getEventForWizard(id);

  if (!event) notFound();

  // A DJ who reaches the confirmation without having sent anything is shown
  // the step they skipped, not an empty summary. A redirect, not a refusal
  // (design §2.1).
  if (event.partners.length < 2) redirect(`/events/new/${id}/invite`);

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    company: profile?.business_name || 'Independent DJ',
  };

  // siteUrl() reads SITE_URL and never a request header: a forged Host or
  // X-Forwarded-Host must not be able to put an attacker's domain into a link
  // the DJ is about to send to the couple. It throws when SITE_URL is unset,
  // so a misconfigured deployment gives this screen a 500 rather than a wrong
  // link -- the right direction to fail.
  const origin = siteUrl();
  const links = {
    1: `${origin}/invite/${event.id}/1`,
    2: `${origin}/invite/${event.id}/2`,
  } as const;

  return (
    <AppShell sidebar={<DashboardSidebar dj={dj} current="none" signOutAction={signOut} />}>
      <NewEventShell current={3} title={event.couple_names}>
        <InviteSent event={event} links={links} />
      </NewEventShell>
    </AppShell>
  );
}
