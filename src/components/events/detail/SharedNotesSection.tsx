'use client';

import { useActionState } from 'react';

import { saveSharedNotes } from '@/lib/events/notesActions';
import type { DetailActionState } from '@/lib/events/detailTypes';
import styles from './SharedNotesSection.module.css';

interface SharedNotesSectionProps {
  eventId: string;
  body: string;
}

/**
 * The note both people on the event can read and write (design §3).
 *
 * Its OWN <form>, not a control associated with the details form: notes now
 * have their own action, and `saveEventDetails` no longer writes them at all.
 * A textarea left on `form={DETAILS_FORM_ID}` would post to an action that
 * ignores it and still flash "Saved ✓".
 *
 * A sibling of the details form, never nested inside it. HTML forbids nested
 * forms and the parser drops the inner one (design §2.2).
 */
export function SharedNotesSection({ eventId, body }: SharedNotesSectionProps) {
  const [state, formAction, isPending] = useActionState<DetailActionState, FormData>(
    saveSharedNotes,
    null,
  );
  const fieldError = state && !state.ok && 'formErrors' in state ? state.formErrors.body : null;
  const message = state && !state.ok && 'message' in state ? state.message : null;

  return (
    <form action={formAction} className={styles.section}>
      <input type="hidden" name="eventId" value={eventId} />

      <h3 className={styles.heading}>Shared notes</h3>
      <p className={styles.blurb}>
        The couple can see and edit this. Keep planning notes in your private notes above.
      </p>

      <textarea
        name="body"
        rows={4}
        maxLength={2000}
        defaultValue={body}
        placeholder="Anything the two of you agreed on together…"
        aria-label="Shared notes"
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
          {isPending ? 'Saving…' : 'Save shared notes'}
        </button>
      </div>
    </form>
  );
}
