import styles from './GuestActivity.module.css';

/**
 * A placeholder shape -- Task 24 fills this in with a real feed. Kept local
 * to this component rather than in liveTypes.ts, since nothing produces real
 * data for it yet (Task 16 scope note: `activity` is always `[]` for now).
 */
export interface LiveActivityItem {
  id: string;
  text: string;
}

/**
 * The live activity feed (design §7.1). `aria-live="polite"` is set on the
 * list itself -- even while it's always empty (Task 16 scope note), because
 * this is about FUTURE updates being announced once Task 24 adds real
 * content, and that matters before the content exists, not just after.
 */
export function GuestActivity({ activity }: { activity: LiveActivityItem[] }) {
  return (
    <section className={styles.section} aria-label="Guest activity">
      <h2 className={styles.heading}>Guest activity</h2>
      <ul className={styles.list} aria-live="polite">
        {activity.length === 0 ? (
          <li className={styles.empty}>No activity yet</li>
        ) : (
          activity.map((item) => <li key={item.id}>{item.text}</li>)
        )}
      </ul>
    </section>
  );
}
