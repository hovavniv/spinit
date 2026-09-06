'use client';

import { useActionState, useState } from 'react';
import type { ActionResult } from '@/lib/auth/errors';
import type { DetailActionState } from '@/lib/events/detailTypes';
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

  // useActionState wants (prevState, formData); endEvent takes formData alone
  // (it has no prevState to thread -- see detailActions.ts). The wrapper adapts
  // the arity and nothing else.
  const [state, formAction, pending] = useActionState<DetailActionState, FormData>(
    async (_prev, formData) => endAction(formData),
    null,
  );
  const errors = state && !state.ok && 'formErrors' in state ? state.formErrors : null;
  const message = state && !state.ok && 'message' in state ? state.message : null;

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
    <div className={`${styles.section} ${styles.sectionConfirming}`}>
      <p className={styles.warning}>
        This closes the event and delivers the recap. It cannot be undone.
      </p>
      <form action={formAction} className={styles.confirm}>
        <input type="hidden" name="eventId" value={eventId} />
        <button type="submit" className={styles.end} disabled={pending}>
          {pending ? 'Ending…' : 'End it'}
        </button>
        <button
          type="button"
          className={styles.cancel}
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancel
        </button>
      </form>

      {(errors?.eventId || message) && (
        <p role="alert" className={styles.error}>
          {errors?.eventId ?? message}
        </p>
      )}
    </div>
  );
}
