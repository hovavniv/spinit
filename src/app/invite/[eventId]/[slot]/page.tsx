import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth/dal';
import { claimInvite } from '@/lib/events/newEventActions';
import { isUuid } from '@/lib/validation';
import { ClaimForm } from './ClaimForm';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Your invitation — Spinit',
};

/**
 * The page a partner opens from the link their DJ sent them (design §4.4).
 *
 * DELIBERATELY GENERIC. It names no couple, no date and no venue: RLS would
 * not show an unclaimed partner the event anyway -- event_partners' select
 * policy admits the row's own user, the event's DJ, or an existing partner,
 * and an unclaimed invitee is none of the three -- and staying generic keeps
 * this route from confirming which event ids exist.
 *
 * requireUser() sends a signed-out visitor to /login. The invitation link is
 * durable, so they open it again after signing in; /login has no return-to
 * parameter and adding one is its own piece of work (design §9.3).
 */
export default async function InvitePage({ params }: PageProps<'/invite/[eventId]/[slot]'>) {
  const { eventId, slot } = await params;

  if (!isUuid(eventId) || (slot !== '1' && slot !== '2')) notFound();

  await requireUser();

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.title}>You&rsquo;ve been invited</h1>
        <p className={styles.blurb}>
          Your DJ has invited you to help plan a wedding on Spinit. Claim your invitation to
          build your must-play list and connect your streaming profile.
        </p>
        <p className={styles.note}>
          Claim it with the account matching the email address your DJ invited.
        </p>

        <ClaimForm
          eventId={eventId}
          slot={slot}
          registerHref={`/register?invite=${eventId}&slot=${slot}`}
          claimAction={claimInvite}
        />
      </div>
    </main>
  );
}
