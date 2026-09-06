import type { ActivityItem } from '@/lib/live/liveTypes';
import { timeAgo } from '@/lib/live/timeAgo';
import styles from './GuestActivity.module.css';

/**
 * The canonical shape lives in liveTypes.ts (Task 24 fills it in --
 * liveDal.ts's `readActivity` is the producer). Re-exported under this
 * component's own established name since LiveScreen.tsx/useLivePoll.ts
 * already import `LiveActivityItem` from here.
 */
export type LiveActivityItem = ActivityItem;

/**
 * The live activity feed (design §7.1, artboard `Spinit Live Event.dc.html`).
 * `aria-live="polite"` is set on the list itself so a guest requesting or
 * backing a song while the DJ is looking at the screen gets announced
 * without the DJ needing to notice a visual change.
 *
 * `now` is read once here, inside a client tree, and passed down to
 * `timeAgo` rather than read inside it -- that function stays a pure,
 * deterministically-testable function of its two arguments, the same
 * pattern `minutesLeftInPhase` (phaseClock.ts) uses.
 *
 * "Last hour on the floor" is accurate, not aspirational: `readActivity`
 * filters on a one-hour cutoff. If that cutoff ever changes, this copy
 * changes with it.
 */
export function GuestActivity({ activity }: { activity: LiveActivityItem[] }) {
  const now = new Date();

  return (
    <section className={styles.section} aria-label="Guest activity">
      <div className={styles.headerRow}>
        <h2 className={styles.heading}>Guest activity</h2>
        <p className={styles.subhead}>Last hour on the floor.</p>
      </div>
      <ul className={styles.list} aria-live="polite">
        {activity.length === 0 ? (
          <li className={styles.empty}>No activity yet</li>
        ) : (
          activity.map((item) => (
            <li key={item.id} className={styles.row}>
              <span className={styles.time}>{timeAgo(item.createdAt, now)}</span>
              <span className={styles.text}>
                {item.guestName} {item.verb} <strong>{item.title}</strong>
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
