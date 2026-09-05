'use client';

import type { EventPhase } from '@/lib/dashboard/types';
import { PHASE_LABELS } from '@/lib/dashboard/types';
import styles from './PhasePicker.module.css';

const PHASES: EventPhase[] = ['cocktails', 'dinner', 'open-floor', 'last-dance'];

/**
 * A four-option segmented control, not four buttons that look like one
 * (design §7.6): `phase` is a ranking input (CLAUDE.md), and this is the only
 * control in the app that can change it. Used both on the pre-flight screen
 * (picking the starting phase) and later in the live header (changing it
 * mid-event).
 */
export function PhasePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: EventPhase;
  onChange: (phase: EventPhase) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.group} role="radiogroup" aria-label="Event phase">
      {PHASES.map((phase) => (
        <button
          key={phase}
          type="button"
          role="radio"
          aria-checked={value === phase}
          disabled={disabled}
          className={value === phase ? `${styles.option} ${styles.optionSelected}` : styles.option}
          onClick={() => onChange(phase)}
        >
          {PHASE_LABELS[phase]}
        </button>
      ))}
    </div>
  );
}
