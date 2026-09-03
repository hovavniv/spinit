'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import type { ActionResult } from '@/lib/auth/errors';
import type { WizardActionState, WizardPartner } from '@/lib/events/newEventTypes';
import styles from './InviteStep.module.css';

interface InviteStepProps {
  eventId: string;
  partner1Name: string;
  partner2Name: string;
  partners: WizardPartner[];
  sendAction: (prevState: WizardActionState, formData: FormData) => Promise<ActionResult>;
}

/**
 * Step 2 of the New Event artboard (design §4.2).
 *
 * TWO fields, both emails. The artboard has no name fields here and is right
 * not to: step 1 collected both names and events.partner1_name/partner2_name
 * store them, so display_name is filled from there rather than asking twice.
 *
 * The blurb deviates from the artboard's "They'll get a private link", because
 * nothing in this repo sends email. Saying so is the point: a screen that
 * claims an invitation was sent when none was is worse than one that explains
 * what actually happens (design §9.1).
 */
export function InviteStep({
  eventId,
  partner1Name,
  partner2Name,
  partners,
  sendAction,
}: InviteStepProps) {
  const [state, formAction, isPending] = useActionState<WizardActionState, FormData>(
    sendAction,
    null,
  );

  const errors = state && !state.ok && 'formErrors' in state ? state.formErrors : null;
  const message = state && !state.ok && 'message' in state ? state.message : null;

  // BY SLOT, never by array position -- see InviteStep.test.tsx for why.
  const emailFor = (slot: 1 | 2) => partners.find((p) => p.slot === slot)?.invite_email ?? '';

  return (
    <form action={formAction}>
      <h2 className={styles.heading}>Invite the couple</h2>
      <p className={styles.blurb}>
        You&rsquo;ll get a private link for each of them to send however you like — text,
        WhatsApp, email. They use it to build their must-play list and connect their streaming
        profiles before your first meeting.
      </p>

      <input type="hidden" name="eventId" value={eventId} readOnly />

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>{partner1Name}&rsquo;s email</span>
          <input
            name="email1"
            type="email"
            required
            maxLength={254}
            defaultValue={emailFor(1)}
            aria-invalid={!!errors?.email1}
            className={styles.input}
          />
          {errors?.email1 && <span role="alert" className={styles.error}>{errors.email1}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{partner2Name}&rsquo;s email</span>
          <input
            name="email2"
            type="email"
            required
            maxLength={254}
            defaultValue={emailFor(2)}
            aria-invalid={!!errors?.email2}
            className={styles.input}
          />
          {errors?.email2 && <span role="alert" className={styles.error}>{errors.email2}</span>}
        </label>
      </div>

      <div className={styles.actions}>
        <Link href={`/events/new/${eventId}`} className={styles.back}>
          ← Back
        </Link>
        <div className={styles.right}>
          {message && <span role="alert" className={styles.error}>{message}</span>}
          <button type="submit" className={styles.primary} disabled={isPending}>
            {isPending ? 'Saving…' : 'Send invites'}
          </button>
        </div>
      </div>
    </form>
  );
}
