import { DETAILS_FORM_ID } from './formId';
import styles from './NotesSection.module.css';

interface NotesSectionProps {
  notes: string | null;
}

/**
 * The artboard's "Additional notes" block. Like the ceremony slots, the
 * textarea is associated with the details form by id rather than wrapped in
 * one (design §2.2).
 */
export function NotesSection({ notes }: NotesSectionProps) {
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Additional notes</h3>
      <p className={styles.blurb}>
        Anything else worth remembering — family dynamics, timeline quirks, allergies.
      </p>
      <textarea
        name="notes"
        rows={4}
        maxLength={2000}
        defaultValue={notes ?? ''}
        placeholder="Notes from the couple or your planning call…"
        aria-label="Additional notes"
        form={DETAILS_FORM_ID}
        className={styles.textarea}
      />
    </section>
  );
}
