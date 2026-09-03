import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { listPartnerEvents } from '@/lib/events/partnerEventsDal';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Your event — Spinit',
};

/**
 * /my-event — plan task 14. A REDIRECTOR, not a second view of event data:
 * design §2.4 rejects a separate couple-facing page over the same data
 * because it "doubles every screen for one differing button", and this is
 * compatible with that reasoning only as long as it resolves a role and
 * forwards. If this page ever grows into rendering event data itself, it has
 * become the thing §2.4 rejects.
 *
 * No artboard exists for this screen: a DJ has several events and needs a
 * list (Upcoming/Past), a partner has one and needs to be IN it. Different
 * screens, not one screen with a different query.
 *
 * requireUser() runs here, in the page, for the same reason every other page
 * in this tree calls it directly rather than in a layout.
 */
export default async function MyEventPage() {
  const user = await requireUser();
  const profile = await getProfile();
  const events = await listPartnerEvents();

  // The common case: exactly one event to be in. Forward straight into it
  // rather than making the partner click through a list of one.
  if (events.length === 1) {
    redirect(`/events/${events[0].id}`);
  }

  const dj = {
    name: profile?.full_name || user.email || 'You',
    // This route only exists for partners (see the doc comment above), so
    // unlike /events/[id] there is no DJ case to fall back to here at all
    // (design §9.5, now fixed).
    company: 'Getting married',
  };

  return (
    <AppShell sidebar={<DashboardSidebar dj={dj} current="none" hideNav />}>
      <h1 className={styles.title}>Your event</h1>
      {events.length === 0 ? (
        <p className={styles.empty}>
          You&rsquo;re not linked to an event yet. Ask your DJ for the link they sent you.
        </p>
      ) : (
        <ul className={styles.list}>
          {events.map((event) => (
            <li key={event.id} className={styles.row}>
              <Link href={`/events/${event.id}`} className={styles.link}>
                {event.couple_names}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
