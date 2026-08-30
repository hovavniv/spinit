'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import type { ActionResult } from '@/lib/auth/errors';
import type { DetailActionState } from '@/lib/events/detailTypes';
import { DETAILS_FORM_ID } from './formId';
import styles from './EventDetailsForm.module.css';

interface EventDetailsFormProps {
  eventId: string;
  saveAction: (prevState: DetailActionState, formData: FormData) => Promise<ActionResult>;
}

/**
 * The bottom bar: back, "Save changes", and the artboard's "Saved ✓" flash.
 *
 * This renders the ONLY <form id="event-details"> on the page, as a SIBLING of
 * the ceremony and notes blocks — never a wrapper around them. Wrapping would
 * enclose the four list sections' own forms, which the HTML parser drops
 * (design §2.2). The ceremony inputs and the notes textarea reach this form
 * through their form="event-details" attribute; the browser submits
 * form-associated controls with it, so the no-JavaScript path is unaffected.
 *
 * The artboard's "← Back" moves between wizard steps. With steps 1–2 out of
 * scope it goes to the dashboard, which is where a DJ pressing back from this
 * page wants to be (design §4).
 */
export function EventDetailsForm({ eventId, saveAction }: EventDetailsFormProps) {
  const [state, formAction, isPending] = useActionState<DetailActionState, FormData>(
    saveAction,
    null,
  );
  const message = state && !state.ok ? ('message' in state ? state.message : 'Check the fields above.') : null;

  return (
    <form id={DETAILS_FORM_ID} action={formAction} className={styles.bar}>
      <input type="hidden" name="eventId" value={eventId} />

      <Link href="/dashboard" className={styles.back}>
        ← Back
      </Link>

      <div className={styles.right}>
        {message && (
          <span role="alert" className={styles.error}>
            {message}
          </span>
        )}
        {state?.ok && !isPending && <span className={styles.saved}>Saved ✓</span>}
        <button type="submit" className={styles.save} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
