'use client';

import { useActionState, useState } from 'react';

import type { ActionResult } from '@/lib/auth/errors';
import {
  artworkKey,
  type AddableSegment,
  type BlocklistEntryType,
  type BlocklistRow,
  type DetailActionState,
} from '@/lib/events/detailTypes';
import { GenrePicker } from './GenrePicker';
import { TrackPicker } from './TrackPicker';
import styles from './BlocklistSection.module.css';

/**
 * A song row's id is a TRACK id and an artist row's is an ARTIST id -- the
 * column (`spotify_id`) is shared but the namespace is not, which is why
 * artworkKey is prefixed by kind. A genre row has no id and no picture.
 */
function artworkUrlFor(row: BlocklistRow, artworkById: Record<string, string>): string | undefined {
  if (row.entry_type === 'song') return artworkById[artworkKey('track', row.spotify_id)];
  if (row.entry_type === 'artist') return artworkById[artworkKey('artist', row.spotify_id)];
  return undefined;
}

/**
 * Square for a song, round for an artist -- the same convention as the picker
 * dropdown, so the shape alone says which kind of thing a row blocks. A genre
 * renders NOTHING, not an empty box: a genre has no artwork in principle, and
 * a permanently blank square would read as a picture that failed to load.
 * Song and artist rows do draw the empty box, so their text stays aligned.
 */
function RowArtwork({ entryType, url }: { entryType: BlocklistEntryType; url: string | undefined }) {
  if (entryType === 'genre') return null;
  const shape = entryType === 'artist' ? styles.rowArtworkArtist : styles.rowArtworkSong;
  if (url) return <img src={url} alt="" className={`${styles.rowArtwork} ${shape}`} />;
  return <div aria-hidden className={`${styles.rowArtwork} ${shape}`} />;
}

interface BlocklistSectionProps {
  eventId: string;
  segment: AddableSegment;
  blurb: string;
  rows: BlocklistRow[];
  /** EventDetail.artworkById. A missing entry means "no picture", never an
   *  error — see that field's comment. */
  artworkById: Record<string, string>;
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
  artworkById,
  addAction,
  removeAction,
}: BlocklistSectionProps) {
  const [state, formAction] = useActionState<DetailActionState, FormData>(addAction, null);
  const errors = state && !state.ok && 'formErrors' in state ? state.formErrors : null;
  const message = state && !state.ok && 'message' in state ? state.message : null;
  const [entryType, setEntryType] = useState<BlocklistEntryType>('artist');

  return (
    <div className={styles.block}>
      <div className={styles.label}>Do-not-play</div>
      <p className={styles.blurb}>{blurb}</p>

      {rows.length > 0 && (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles.rowText}>
                <RowArtwork entryType={row.entry_type} url={artworkUrlFor(row, artworkById)} />
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
        <select
          name="entryType"
          value={entryType}
          onChange={(event) => setEntryType(event.target.value as BlocklistEntryType)}
          aria-label="Type"
          className={styles.select}
        >
          <option value="artist">Artist</option>
          <option value="song">Song</option>
          <option value="genre">Genre</option>
        </select>
        {entryType === 'artist' && (
          <TrackPicker key="artist" searchType="artist" fields={{ kind: 'singleValue', valueName: 'value' }} />
        )}
        {entryType === 'song' && (
          <TrackPicker key="song" searchType="track" fields={{ kind: 'singleValue', valueName: 'value' }} />
        )}
        {entryType === 'genre' && <GenrePicker key="genre" valueName="value" />}
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
