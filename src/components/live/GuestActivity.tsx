import type { ActivityItem } from '@/lib/live/liveTypes';
import styles from './GuestActivity.module.css';

/**
 * The canonical shape lives in liveTypes.ts (Task 24 fills it in --
 * liveDal.ts's `readActivity` is the producer). Re-exported under this
 * component's own established name since LiveScreen.tsx/useLivePoll.ts
 * already import `LiveActivityItem` from here.
 */
export type LiveActivityItem = ActivityItem;

/**
 * `guestName` and `title` are the guest's own UNTRUSTED display text
 * (design §3.3/§4.8, and liveTypes.ts's own comment on ActivityItem) --
 * fine to render here, React's escaping handles it, this is not an
 * escaping concern.
 */
function formatActivityText(item: ActivityItem): string {
  return `${item.guestName} ${item.verb} ${item.title}`;
}

/**
 * The live activity feed (design §7.1). `aria-live="polite"` is set on the
 * list itself so a guest requesting or backing a song while the DJ is
 * looking at the screen gets announced without the DJ needing to notice a
 * visual change.
 */
export function GuestActivity({ activity }: { activity: LiveActivityItem[] }) {
  return (
    <section className={styles.section} aria-label="Guest activity">
      <h2 className={styles.heading}>Guest activity</h2>
      <ul className={styles.list} aria-live="polite">
        {activity.length === 0 ? (
          <li className={styles.empty}>No activity yet</li>
        ) : (
          activity.map((item) => <li key={item.id}>{formatActivityText(item)}</li>)
        )}
      </ul>
    </section>
  );
}
