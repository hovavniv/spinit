'use client';

import type { EventPhase } from '@/lib/dashboard/types';
import { PHASE_LABELS } from '@/lib/dashboard/types';
import styles from './PhasePicker.module.css';

const PHASES: EventPhase[] = ['dinner', 'open-floor'];

/**
 * A two-option segmented control, not two buttons that look like one
 * (design §7.6): `phase` is a ranking input (CLAUDE.md), and this is the only
 * control in the app that can change it. Used both on the pre-flight screen
 * (picking the starting phase) and later in the live header (changing it
 * mid-event).
 *
 * Collapsed 2026-09-06 from four options to two, matching the couple's
 * Reception/Party segments (docs/specs/2026-09-06-two-phases-spec.md). The
 * labels below ('Reception', 'Party') are what the DJ reads; the underlying
 * EventPhase values ('dinner', 'open-floor') are historical enum labels --
 * see PHASE_LABELS and PHASE_SEGMENT for why.
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
