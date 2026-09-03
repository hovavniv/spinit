'use client';

import { useActionState } from 'react';

import type { ActionResult } from '@/lib/auth/errors';
import type { WizardActionState } from '@/lib/events/newEventTypes';
import styles from './page.module.css';

interface ClaimFormProps {
  eventId: string;
  slot: '1' | '2';
  registerHref: string;
  claimAction: (prevState: WizardActionState, formData: FormData) => Promise<ActionResult>;
}

/**
 * The claim button (design §4.4).
 *
 * THE CLAIM HAPPENS ON A BUTTON PRESS, NEVER ON PAGE LOAD. A GET request that
 * writes is fired by link prefetching, by crawlers, and by anything that
 * follows a URL to see what is there.
 */
export function ClaimForm({ eventId, slot, registerHref, claimAction }: ClaimFormProps) {
  const [state, formAction, isPending] = useActionState<WizardActionState, FormData>(
    claimAction,
    null,
  );

  const message = state && !state.ok && 'message' in state ? state.message : null;

  return (
    <form action={formAction}>
      <input type="hidden" name="eventId" value={eventId} readOnly />
      <input type="hidden" name="slot" value={slot} readOnly />

      <button type="submit" className={styles.primary} disabled={isPending}>
        {isPending ? 'Claiming…' : 'Claim your invitation'}
      </button>

      {message && (
        <p role="alert" className={styles.error}>
          {message}{' '}
          <a href={registerHref} className={styles.link}>
            Create an account
          </a>
          .
        </p>
      )}
    </form>
  );
}
