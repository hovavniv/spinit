'use client';

import { useActionState } from 'react';

import type { ActionResult } from '@/lib/auth/errors';
import type { DetailActionState } from '@/lib/events/detailTypes';
import styles from './NotesSection.module.css';

interface NotesSectionProps {
  eventId: string;
  body: string;
  saveAction: (prevState: DetailActionState, formData: FormData) => Promise<ActionResult>;
}

/**
 * The artboard's "Additional notes" block, now the DJ's PRIVATE note (design
 * §3). Only the event's DJ can read or write this row; a partner's read
 * returns no row at all.
 *
 * Its OWN <form> for the same reason SharedNotesSection has one: notes have
 * their own action and `saveEventDetails` no longer writes them, so a control
 * still associated with the details form would be silently discarded.
 *
 * The screen also hides this section from a partner. That is a convenience,
 * not the control — the policy is (design §3). Do not rely on it either way.
 */
export function NotesSection({ eventId, body, saveAction }: NotesSectionProps) {
  const [state, formAction, isPending] = useActionState<DetailActionState, FormData>(
    saveAction,
    null,
  );
  const fieldError = state && !state.ok && 'formErrors' in state ? state.formErrors.body : null;
  const message = state && !state.ok && 'message' in state ? state.message : null;

  return (
    <form action={formAction} className={styles.section}>
      <input type="hidden" name="eventId" value={eventId} />

      <h3 className={styles.heading}>Your private notes</h3>
      <p className={styles.blurb}>
        Only you can see this. Family dynamics, timeline quirks, allergies.
      </p>

      <textarea
        name="body"
        rows={4}
        maxLength={2000}
        defaultValue={body}
        placeholder="Notes from your planning call…"
        aria-label="Your private notes"
        className={styles.textarea}
      />

      <div className={styles.actions}>
        {(fieldError ?? message) && (
          <span role="alert" className={styles.error}>
            {fieldError ?? message}
          </span>
        )}
        {state?.ok && !isPending && <span className={styles.saved}>Saved ✓</span>}
        <button type="submit" className={styles.save} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save private notes'}
        </button>
      </div>
    </form>
  );
}
