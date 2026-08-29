import Link from 'next/link';
import { formatPastDate } from '@/lib/dashboard/format';
import type { PastEvent } from '@/lib/dashboard/types';
import { SectionHeading } from './SectionHeading';
import styles from './PastEvents.module.css';

interface PastEventsProps {
  events: PastEvent[];
}

/**
 * The "past-events" block from design/artboards/Spinit DJ Dashboard.dc.html
 * — stacked rows. Each row is a single link wrapping its whole content
 * (design/specs/2026-08-29-dj-dashboard-design.md §9), pointing at
 * `/events/[id]/recap`, a faithful mapping of the artboard's "View recap →"
 * link (design §7).
 */
export function PastEvents({ events }: PastEventsProps) {
  return (
    <div className={styles.section}>
      <SectionHeading
        title="Past events"
        viewAllLabel="View all past events"
        viewAllHref="/events/past"
      />
      <div className={styles.list}>
        {events.map((event) => (
          <Link key={event.id} href={`/events/${event.id}/recap`} className={styles.row}>
            <div>
              <div className={styles.coupleNames}>{event.coupleNames}</div>
              <div className={styles.details}>
                {formatPastDate(event.date)} · {event.venue}
              </div>
            </div>
            <div className={styles.right}>
              <span className={styles.songsPlayed}>{event.songsPlayed} songs played</span>
              <span className={styles.viewRecap}>View recap →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
