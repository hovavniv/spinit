'use client';

import { useActionState } from 'react';

import type { ActionResult } from '@/lib/auth/errors';
import type { WizardActionState, WizardEvent } from '@/lib/events/newEventTypes';
import styles from './EventDetailsStep.module.css';

interface EventDetailsStepProps {
  /** null on /events/new (create), a draft on /events/new/[id] (edit). */
  event: WizardEvent | null;
  saveAction: (prevState: WizardActionState, formData: FormData) => Promise<ActionResult>;
}

/**
 * Step 1 of the New Event artboard (design §4.1).
 *
 * A Client Component only so useActionState can render field errors. The form
 * still posts and the action still runs with JavaScript off -- React keys
 * progressive enhancement off the action being a server reference -- and
 * `required` / `max` are browser constraint validation, not scripting.
 *
 * The hidden eventId is what makes saveEventDraft insert or update. It is not
 * a trust boundary: the action re-validates it and RLS scopes the write to
 * this DJ regardless of what is posted.
 */
export function EventDetailsStep({ event, saveAction }: EventDetailsStepProps) {
  const [state, formAction, isPending] = useActionState<WizardActionState, FormData>(
    saveAction,
    null,
  );

  const errors = state && !state.ok && 'formErrors' in state ? state.formErrors : null;
  const message = state && !state.ok && 'message' in state ? state.message : null;

  return (
    <form action={formAction}>
      <h2 className={styles.heading}>Event details</h2>
      <p className={styles.blurb}>The basics — you can edit these anytime.</p>

      <input type="hidden" name="eventId" data-testid="event-id" value={event?.id ?? ''} readOnly />

      <div className={styles.fields}>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>Partner 1 name</span>
            <input
              name="partner1Name"
              type="text"
              required
              maxLength={120}
              defaultValue={event?.partner1_name ?? ''}
              aria-invalid={!!errors?.partner1Name}
              className={styles.input}
            />
            {errors?.partner1Name && <span role="alert" className={styles.error}>{errors.partner1Name}</span>}
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Partner 2 name</span>
            <input
              name="partner2Name"
              type="text"
              required
              maxLength={120}
              defaultValue={event?.partner2_name ?? ''}
              aria-invalid={!!errors?.partner2Name}
              className={styles.input}
            />
            {errors?.partner2Name && <span role="alert" className={styles.error}>{errors.partner2Name}</span>}
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Wedding date</span>
          <input
            name="eventDate"
            type="date"
            required
            defaultValue={event?.event_date ?? ''}
            aria-invalid={!!errors?.eventDate}
            className={styles.input}
          />
          {errors?.eventDate && <span role="alert" className={styles.error}>{errors.eventDate}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Venue</span>
          <input
            name="venue"
            type="text"
            required
            maxLength={120}
            placeholder="Brookline Barn"
            defaultValue={event?.venue ?? ''}
            aria-invalid={!!errors?.venue}
            className={styles.input}
          />
          {errors?.venue && <span role="alert" className={styles.error}>{errors.venue}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Estimated guest count</span>
          <input
            name="guestCount"
            type="number"
            min={1}
            max={10000}
            placeholder="120"
            // `?? ''` and not `?? 0`: absent is blank, not zero.
            defaultValue={event?.guest_count ?? ''}
            aria-invalid={!!errors?.guestCount}
            className={styles.input}
          />
          {errors?.guestCount && <span role="alert" className={styles.error}>{errors.guestCount}</span>}
        </label>
      </div>

      <div className={styles.actions}>
        {message && <span role="alert" className={styles.error}>{message}</span>}
        <button type="submit" className={styles.primary} disabled={isPending}>
          {isPending ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </form>
  );
}
