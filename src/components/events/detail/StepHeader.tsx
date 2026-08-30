import styles from './StepHeader.module.css';

const STEPS = ['Details', 'Invite', 'Streaming'];

/**
 * The 1–2–3 trail from the New Event artboard, drawn as it appears on step 3:
 * every pip filled (`step >= n`), so it reads as a completed trail rather than
 * a prompt. Steps 1 and 2 are inert — the details form and the invite flow are
 * later work, and a link to a route that does not exist is worse than no link
 * (design §2.4).
 */
export function StepHeader() {
  return (
    <ol className={styles.steps} aria-label="Event setup progress">
      {STEPS.map((label, index) => (
        <li key={label} className={styles.step}>
          <span className={styles.pip}>{index + 1}</span>
          <span className={styles.label}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
