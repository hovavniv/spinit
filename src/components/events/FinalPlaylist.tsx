import { songTag } from '@/lib/events/recap';
import type { PlayedSong } from '@/lib/events/types';
import styles from './FinalPlaylist.module.css';

/**
 * The ticket-stub card from design/artboards/Spinit Event Recap.dc.html.
 *
 * This component does NOT sort. It renders the array in the order it is
 * handed, and getEventRecap's `.order('position')` is what establishes that
 * order. Stated because a test that fed it sorted input and asserted the
 * output was sorted would be pinning nothing.
 */
export function FinalPlaylist({ songs }: { songs: PlayedSong[] }) {
  return (
    <section className={styles.card}>
      <div className={styles.rule} aria-hidden="true" />

      <h2 className={styles.heading}>Final playlist</h2>

      {songs.length === 0 ? (
        <p className={styles.empty}>No songs were logged for this event.</p>
      ) : (
        <div className={styles.list}>
          {songs.map((song) => (
            <div key={song.position} className={styles.row}>
              <div className={styles.what}>
                <span className={styles.track}>
                  {song.position}. {song.title}
                </span>{' '}
                <span className={styles.artist}>— {song.artist}</span>
              </div>
              <span className={styles.tag}>{songTag(song)}</span>
            </div>
          ))}
        </div>
      )}

      <div className={`${styles.rule} ${styles.ruleBottom}`} aria-hidden="true" />
    </section>
  );
}
