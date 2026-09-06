import type { Metadata } from 'next';
import Link from 'next/link';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { signOut } from '@/lib/auth/actions';
import { listActiveEvents } from '@/lib/dashboard/dal';
import { toUpcomingEvents } from '@/lib/dashboard/fromDb';
import { currentLocalNow } from '@/lib/dashboard/now';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { UpcomingEventsList } from '@/components/events/UpcomingEventsList';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Upcoming events — Spinit',
};

/**
 * /events/upcoming — `Spinit Upcoming Events.dc.html`. Linked from the
 * sidebar's middle nav item and from the dashboard card's "View all"; both
 * 404'd until this route existed.
 *
 * No DAL of its own: listActiveEvents + toUpcomingEvents already produce
 * exactly these rows for the dashboard, and a second function counting the
 * same embedded connection rows by its own logic is the thing dal.ts's
 * comments warn against (design §3.1). One live row is fetched and dropped.
 *
 * requireUser() runs here in the page, not a layout, for the reason
 * /dashboard and /events/past both record: a layout check does not re-run on
 * client-side navigation and does not block child segments rendering.
 */
export default async function UpcomingEventsPage() {
  const user = await requireUser();
  const [profile, activeRows] = await Promise.all([getProfile(), listActiveEvents()]);

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    // business_name is nullable and at least one live row is null. Falling back
    // to '' renders an EMPTY chip where the artboard always draws a line, which
    // reads as a broken component rather than as absent data.
    company: profile?.business_name || 'Independent DJ',
  };

  return (
    <AppShell sidebar={<DashboardSidebar dj={dj} current="upcoming" signOutAction={signOut} />}>
      <div className={styles.header}>
        <h1 className={styles.title}>Upcoming events</h1>
        <Link href="/events/new" className={styles.newEvent}>
          + New event
        </Link>
      </div>
      <UpcomingEventsList events={toUpcomingEvents(activeRows)} now={currentLocalNow()} />
    </AppShell>
  );
}
