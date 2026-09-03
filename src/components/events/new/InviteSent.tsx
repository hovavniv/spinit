import Link from 'next/link';

import type { WizardEvent } from '@/lib/events/newEventTypes';
import { CopyLink } from './CopyLink';
import styles from './InviteSent.module.css';

interface InviteSentProps {
  event: WizardEvent;
  links: Record<1 | 2, string>;
}

/**
 * The artboard's "Invite sent ✓" card (design §4.3).
 *
 * A Server Component: it renders no handlers of its own. CopyLink is the one
 * client island inside it.
 *
 * "Links ready for 2 addresses", not the artboard's "Invite sent to 2 emails".
 * Nothing sent anything, and this screen must not say otherwise.
 */
export function InviteSent({ event, links }: InviteSentProps) {
  const partner = (slot: 1 | 2) => event.partners.find((p) => p.slot === slot);

  return (
    <div>
      <div className={styles.tick} aria-hidden="true">✓</div>
      <h2 className={styles.heading}>Links ready</h2>
      <p className={styles.blurb}>
        Send each of them their own link. They&rsquo;ll use it to connect their streaming
        profiles and build their must-play list before your planning call.
      </p>

      <dl className={styles.summary}>
        <div className={styles.summaryRow}>
          <dt className={styles.summaryLabel}>Event</dt>
          <dd className={styles.summaryValue}>
            {event.couple_names} · {event.event_date} · {event.venue}
          </dd>
        </div>
        {event.guest_count !== null && (
          <div className={styles.summaryRow}>
            <dt className={styles.summaryLabel}>Guests</dt>
            <dd className={styles.summaryValue}>{event.guest_count} guests</dd>
          </div>
        )}
        <div className={styles.summaryRow}>
          <dt className={styles.summaryLabel}>Invited</dt>
          <dd className={styles.summaryValue}>
            {partner(1)?.invite_email} · {partner(2)?.invite_email}
          </dd>
        </div>
        <div className={styles.summaryRow}>
          <dt className={styles.summaryLabel}>Status</dt>
          <dd className={styles.summaryValue}>Awaiting response</dd>
        </div>
      </dl>

      <div className={styles.links}>
        <CopyLink label={partner(1)?.display_name ?? 'Partner 1'} url={links[1]} />
        <CopyLink label={partner(2)?.display_name ?? 'Partner 2'} url={links[2]} />
      </div>

      <div className={styles.actions}>
        <Link href={`/events/${event.id}`} className={styles.back}>
          ← Back to streaming step
        </Link>
        <Link href="/dashboard" className={styles.primary}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
