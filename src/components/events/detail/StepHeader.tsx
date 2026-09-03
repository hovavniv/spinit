import styles from './StepHeader.module.css';

const STEPS = ['Details', 'Invite', 'Streaming'];

interface StepHeaderProps {
  /**
   * Which step the screen is on. Defaults to 3 so the existing call in
   * EventDetailScreen -- `<StepHeader />` with no props -- renders exactly as
   * it did before: every pip filled, reading as a completed trail.
   */
  current?: 1 | 2 | 3;
}

/**
 * The 1–2–3 trail from the New Event artboard.
 *
 * Pips at or below `current` are filled; the rest are outlines. The pip AT
 * `current` carries aria-current="step" -- a real accessible marker, so a
 * screen test can assert which step is active. A CSS-module class name is
 * hashed and jsdom computes nothing from it, so a class assertion would pin
 * nothing (design §4.5).
 *
 * The steps are inert here: the wizard's own navigation is its Continue and
 * Back buttons, and a link to a step the DJ has not reached yet would be a
 * link to a route that 404s.
 */
export function StepHeader({ current = 3 }: StepHeaderProps) {
  return (
    <ol className={styles.steps} aria-label="Event setup progress">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const done = step <= current;
        return (
          <li key={label} className={styles.step}>
            <span
              className={`${styles.pip} ${done ? styles.pipDone : styles.pipTodo}`}
              aria-current={step === current ? 'step' : undefined}
            >
              {step}
            </span>
            <span className={styles.label}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
