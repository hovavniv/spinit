'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { ActionResult } from '@/lib/auth/errors';
import type { DetailActionState } from '@/lib/events/detailTypes';
import styles from './EndEventControl.module.css';

/**
 * The live header's "End event" control (design §7.1, §12: "imported" --
 * this branch never writes `status = 'completed'` itself, it calls
 * `feat/upcoming-events`' own `endEvent`, the only writer of that
 * transition). Not a reuse of `EndEventSection` (the equivalent control on
 * `/events/[id]`): that component belongs to the other branch's files and
 * has no way to navigate on success, and this screen needs one that does --
 * `/events/[id]/live` 404s the instant `status` leaves `live`/`upcoming`
 * (its own guard), so `router.refresh()` here would show the DJ a 404 right
 * after they confirm ending the event. Redirects to the recap instead,
 * which is what the confirmation copy already promises ("delivers the
 * recap"). The confirm-then-submit shape and the `useActionState` wiring
 * mirror `EndEventSection` deliberately -- same action, same contract,
 * different post-success behaviour.
 */
export function EndEventControl({
  eventId,
  endAction,
}: {
  eventId: string;
  endAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  const [state, formAction, pending] = useActionState<DetailActionState, FormData>(
    async (_prev, formData) => {
      const result = await endAction(formData);
      if (result.ok) {
        router.push(`/events/${eventId}/recap`);
      }
      return result;
    },
    null,
  );
  const message = state && !state.ok && 'message' in state ? state.message : null;
  const fieldError = state && !state.ok && 'formErrors' in state ? state.formErrors.eventId : null;

  if (!confirming) {
    return (
      <button type="button" className={styles.end} onClick={() => setConfirming(true)}>
        End event
      </button>
    );
  }

  return (
    <div className={styles.confirmWrap}>
      <p className={styles.warning}>This closes the event and delivers the recap. It cannot be undone.</p>
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
      {(fieldError || message) && (
        <p role="alert" className={styles.error}>
          {fieldError ?? message}
        </p>
      )}
    </div>
  );
}
