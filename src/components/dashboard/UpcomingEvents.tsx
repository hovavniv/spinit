import Link from 'next/link';
import { formatCardDate, daysUntil } from '@/lib/dashboard/format';
import type { UpcomingEvent } from '@/lib/dashboard/types';
import { SectionHeading } from './SectionHeading';
import styles from './UpcomingEvents.module.css';

interface UpcomingEventsProps {
  events: UpcomingEvent[];
  now: string;
}

const STATUS_LABEL: Record<UpcomingEvent['status'], string> = {
  'streaming-connected': 'Streaming connected',
  'awaiting-couple': 'Awaiting couple',
};

/**
 * The "upcoming-events" block from design/artboards/Spinit DJ Dashboard.dc.html
 * — a two-column grid of cards. Each card is a single link wrapping its whole
 * content (design/specs/2026-08-29-dj-dashboard-design.md §9), pointing at
 * `/events/[id]` — a deliberate correction of the artboard's `?event=` link
 * to the New Event screen, not a transcription (design §7).
 *
 * Holds the two status-pill variants directly rather than as their own
 * component: a single <span> with two variants used in one place does not
 * earn its own file (design §4).
 */
export function UpcomingEvents({ events, now }: UpcomingEventsProps) {
  return (
    <div className={styles.section}>
      <SectionHeading
        title="Upcoming events"
        viewAllLabel="View all upcoming events"
        viewAllHref="/events/upcoming"
      />
      <div className={styles.grid}>
        {events.map((event) => {
          const chip = daysUntil(event.date, now);
          return (
            <Link key={event.id} href={`/events/${event.id}`} className={styles.card}>
              <div className={styles.top}>
                <div className={styles.coupleNames}>{event.coupleNames}</div>
                <div className={styles.date}>{formatCardDate(event.date)}</div>
              </div>
              <div className={styles.venue}>{event.venue}</div>
              <div className={styles.bottom}>
                <span
                  className={
                    event.status === 'streaming-connected'
                      ? styles.pillConnected
                      : styles.pillAwaiting
                  }
                >
                  {STATUS_LABEL[event.status]}
                </span>
                {chip !== null && <span className={styles.daysUntil}>{chip}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
