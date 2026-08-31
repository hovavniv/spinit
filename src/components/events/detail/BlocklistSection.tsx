'use client';

import { useActionState } from 'react';

import type { ActionResult } from '@/lib/auth/errors';
import type { AddableSegment, BlocklistRow, DetailActionState } from '@/lib/events/detailTypes';
import styles from './BlocklistSection.module.css';

interface BlocklistSectionProps {
  eventId: string;
  segment: AddableSegment;
  blurb: string;
  rows: BlocklistRow[];
  addAction: (prevState: DetailActionState, formData: FormData) => Promise<ActionResult>;
  removeAction: (formData: FormData) => Promise<ActionResult>;
}

/**
 * A do-not-play list — rendered once for Reception and once for Party.
 * Client only for `useActionState`; see MustPlaySection for why that does not
 * cost the no-JavaScript path.
 *
 * The type pill is upper-cased in CSS, not in the data: the stored value is
 * the enum member ('artist'), and a test that reads the DOM should see the
 * value the database holds.
 */
export function BlocklistSection({
  eventId,
  segment,
  blurb,
  rows,
  addAction,
  removeAction,
}: BlocklistSectionProps) {
  const [state, formAction] = useActionState<DetailActionState, FormData>(addAction, null);
  const errors = state && !state.ok && 'formErrors' in state ? state.formErrors : null;
  const message = state && !state.ok && 'message' in state ? state.message : null;

  return (
    <div className={styles.block}>
      <div className={styles.label}>Do-not-play</div>
      <p className={styles.blurb}>{blurb}</p>

      {rows.length > 0 && (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.pill}>{row.entry_type}</span>
                <span className={styles.value}>{row.value}</span>
              </div>
              <form
                action={(rowFormData: FormData) => {
                  // See MustPlaySection for why this wraps rather than passes
                  // removeAction directly: the DOM action prop wants void.
                  void removeAction(rowFormData);
                }}
              >
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="eventId" value={eventId} />
                <button type="submit" className={styles.remove} aria-label={`Remove ${row.value}`}>
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className={styles.addRow}>
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="segment" value={segment} />
        <select name="entryType" defaultValue="artist" aria-label="Type" className={styles.select}>
          <option value="artist">Artist</option>
          <option value="song">Song</option>
          <option value="genre">Genre</option>
        </select>
        <input
          type="text"
          name="value"
          placeholder="e.g. Nickelback"
          required
          maxLength={100}
          className={styles.input}
          aria-label="Artist, song or genre"
        />
        <button type="submit" className={styles.add}>
          Add
        </button>
      </form>

      {(errors?.value || errors?.entryType || message) && (
        <p role="alert" className={styles.error}>
          {errors?.value ?? errors?.entryType ?? message}
        </p>
      )}
    </div>
  );
}
