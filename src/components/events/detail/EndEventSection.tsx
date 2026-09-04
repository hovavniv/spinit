'use client';

import { useState } from 'react';
import type { ActionResult } from '@/lib/auth/errors';
import styles from './EndEventSection.module.css';

interface EndEventSectionProps {
  eventId: string;
  /**
   * Computed by the SERVER component that renders this (design §3.6).
   *
   * Deliberately a decision, not the inputs to one: evaluating "has this date
   * passed" here would read the VIEWER'S BROWSER timezone — a third clock,
   * after the two the lifecycle rule already reconciles — and would be wrong
   * for a DJ who is travelling.
   */
  canEnd: boolean;
  endAction: (formData: FormData) => Promise<ActionResult>;
}

/**
 * The DJ's "End event" control, in its own file for two reasons.
 *
 * EventDetailScreen is a Server Component, and the inline-closure form action
 * remedy is CLIENT-COMPONENT-ONLY — an inline closure cannot cross the RSC
 * serialization boundary and throws on render. This file is 'use client', so
 * it uses the same wiring MustPlaySection and BlocklistSection already use.
 *
 * And it needs state: ending is one-way, so it asks twice.
 */
export function EndEventSection({ eventId, canEnd, endAction }: EndEventSectionProps) {
  const [confirming, setConfirming] = useState(false);

  if (!canEnd) return null;

  if (!confirming) {
    return (
      <div className={styles.section}>
        <button type="button" className={styles.end} onClick={() => setConfirming(true)}>
          End event
        </button>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <p className={styles.warning}>
        This closes the event and delivers the recap. It cannot be undone.
      </p>
      <form
        // The client-component remedy: the action returns an ActionResult, and
        // a function returning Promise<T> is not assignable where
        // `void | Promise<void>` is expected. Wrapping keeps the action's real
        // signature honest instead of weakening its return type.
        action={(formData: FormData) => {
          void endAction(formData);
        }}
        className={styles.confirm}
      >
        <input type="hidden" name="eventId" value={eventId} />
        <button type="submit" className={styles.end}>
          End it
        </button>
        <button type="button" className={styles.cancel} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </form>
    </div>
  );
}
