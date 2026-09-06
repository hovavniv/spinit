import type { Metadata } from 'next';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { signOut } from '@/lib/auth/actions';
import { listPastEvents } from '@/lib/events/dal';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { PastEventsList } from '@/components/events/PastEventsList';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Past events — Spinit',
};

/**
 * /events/past — design/artboards/Spinit Past Events.dc.html.
 *
 * requireUser() is called here in the page, not in a layout: Next's own docs
 * warn that a layout check does not re-run on client-side navigation and does
 * not block child segments from rendering, so the real gate belongs in the
 * page (the same reasoning src/app/dashboard/page.tsx records).
 */
export default async function PastEventsPage() {
  const user = await requireUser();
  const profile = await getProfile();
  const events = await listPastEvents();

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    // business_name is nullable and at least one live row is null (verified
    // 2026-08-29). Falling back to '' renders an EMPTY chip where the artboard
    // always draws a line, which reads as a broken component rather than as
    // absent data. DashboardSidebar's `company` is a plain string, so the
    // fallback goes here rather than turning the prop optional -- that would
    // be an interface change to another branch's component.
    company: profile?.business_name || 'Independent DJ',
  };

  return (
    <AppShell sidebar={<DashboardSidebar dj={dj} current="past" signOutAction={signOut} />}>
      <h1 className={styles.title}>Past events</h1>
      <PastEventsList events={events} />
    </AppShell>
  );
}
