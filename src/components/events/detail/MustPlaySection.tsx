'use client';

import { useActionState } from 'react';

import type { ActionResult } from '@/lib/auth/errors';
import { artworkKey, type AddableSegment, type DetailActionState, type MustPlayRow } from '@/lib/events/detailTypes';
import { TrackPicker } from './TrackPicker';
import styles from './MustPlaySection.module.css';

/**
 * The row thumbnail. Always renders a box, image or not: a row whose artwork
 * is missing (a pre-picker row, a 404, a failed call) must line its text up
 * with the rows around it, and a conditional element would make the list
 * ragged. Square, matching the picker dropdown's song artwork.
 */
function RowArtwork({ url }: { url: string | undefined }) {
  if (url) return <img src={url} alt="" className={styles.rowArtwork} />;
  return <div aria-hidden className={styles.rowArtwork} />;
}

interface MustPlaySectionProps {
  eventId: string;
  segment: AddableSegment;
  blurb: string;
  rows: MustPlayRow[];
  /** EventDetail.artworkById. A missing entry means "no picture", never an
   *  error — see that field's comment. */
  artworkById: Record<string, string>;
  addAction: (prevState: DetailActionState, formData: FormData) => Promise<ActionResult>;
  removeAction: (formData: FormData) => Promise<ActionResult>;
}

/**
 * A must-play list — rendered once for Reception and once for Party. The
 * artboard duplicates this markup for the two because a canvas has no
 * components; the copy is the only difference, so it is a prop.
 *
 * A Client Component only so `useActionState` can render the add form's error
 * message. The form still posts and the action still runs with JavaScript
 * off — React keys progressive enhancement off the action being a server
 * reference — and `required` / `maxLength` are browser constraint validation,
 * not scripting (design §2.2).
 *
 * Every row's × is its own <form>. This section must never be nested inside
 * the ceremony/notes form: HTML forbids nested forms and the parser would drop
 * these, turning every button here into a save-notes submit (design §2.2).
 */
export function MustPlaySection({
  eventId,
  segment,
  blurb,
  rows,
  artworkById,
  addAction,
  removeAction,
}: MustPlaySectionProps) {
  const [state, formAction] = useActionState<DetailActionState, FormData>(addAction, null);
  const errors = state && !state.ok && 'formErrors' in state ? state.formErrors : null;
  const message = state && !state.ok && 'message' in state ? state.message : null;

  return (
    <div className={styles.block}>
      <div className={styles.label}>Must-play</div>
      <p className={styles.blurb}>{blurb}</p>

      {rows.length > 0 && (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <RowArtwork url={artworkById[artworkKey('track', row.spotify_track_id)]} />
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>
                  {row.title}
                  {row.artist && <span className={styles.rowArtist}> — {row.artist}</span>}
                </div>
                {row.moment && <div className={styles.rowMoment}>{row.moment}</div>}
              </div>
              <form
                action={(rowFormData: FormData) => {
                  // React's <form action> DOM typing wants void | Promise<void>;
                  // removeAction returns Promise<ActionResult> so the caller can
                  // observe a silent-zero-row failure (see detailActions.ts).
                  // Discarding it here, not in removeAction's signature, keeps
                  // that signature honest for the caller that DOES want it.
                  void removeAction(rowFormData);
                }}
              >
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="eventId" value={eventId} />
                <button type="submit" className={styles.remove} aria-label={`Remove ${row.title}`}>
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
        <TrackPicker fields={{ kind: 'titleArtist', titleName: 'title', artistName: 'artist' }} />
        <input
          type="text"
          name="moment"
          placeholder="Moment (optional)"
          maxLength={100}
          className={styles.inputMoment}
          aria-label="Moment"
        />
        <button type="submit" className={styles.add}>
          Add
        </button>
      </form>

      {(errors?.title || errors?.artist || errors?.moment || message) && (
        <p role="alert" className={styles.error}>
          {errors?.title ?? errors?.artist ?? errors?.moment ?? message}
        </p>
      )}
    </div>
  );
}
