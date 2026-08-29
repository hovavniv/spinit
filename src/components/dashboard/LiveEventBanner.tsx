import Link from 'next/link';
import { formatStartTime } from '@/lib/dashboard/format';
import { PHASE_LABELS, type LiveEvent } from '@/lib/dashboard/types';
import styles from './LiveEventBanner.module.css';

interface LiveEventBannerProps {
  liveEvent: LiveEvent;
}

/**
 * The pink live-event banner, from design/artboards/Spinit DJ Dashboard.dc.html
 * (the `sc-if showLiveBanner` block). Rendered by the parent only when a live
 * event exists (design/specs/2026-08-29-dj-dashboard-design.md §7) — this
 * component takes a non-nullable LiveEvent.
 */
export function LiveEventBanner({ liveEvent }: LiveEventBannerProps) {
  return (
    <div className={styles.banner}>
      <div className={styles.left}>
        <div className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          Live
        </div>
        <div>
          <div className={styles.coupleNames}>{liveEvent.coupleNames}</div>
          <div className={styles.details}>
            {liveEvent.venue} · {PHASE_LABELS[liveEvent.phase]} · started{' '}
            {formatStartTime(liveEvent.startedAt)}
          </div>
        </div>
      </div>
      <Link href={`/events/${liveEvent.id}/live`} className={styles.manage}>
        Manage live event →
      </Link>
    </div>
  );
}
