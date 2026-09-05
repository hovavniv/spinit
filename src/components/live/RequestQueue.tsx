'use client';

import type { RankedSong } from '@/lib/live/liveTypes';
import { renderReasons } from '@/lib/live/reasons';
import styles from './RequestQueue.module.css';

/**
 * The ranked, non-blocked queue (design §7.1, §7.4). The why line under every
 * row is the whole point of the explainable-engine differentiator (CLAUDE.md)
 * -- rendered via `renderReasons`, never reimplemented here.
 *
 * Play/Skip are inert by design (Task 16 scope note): `playSuggestion` /
 * `skipSuggestion` don't exist until the next task. The buttons are real
 * elements with accessible names naming the song, not bare "Play"/"Skip".
 */
export function RequestQueue({ queue }: { queue: RankedSong[] }) {
  return (
    <section className={styles.section} aria-label="Request queue">
      <h2 className={styles.heading}>Request queue ({queue.length})</h2>
      <ul className={styles.list}>
        {queue.map((row) => {
          const title = row.suggestion.resolvedTitle ?? row.suggestion.title;
          const artist = row.suggestion.resolvedArtist ?? row.suggestion.artist;
          const isMustPlay = row.reasons.some((reason) => reason.kind === 'must-play-unplayed');
          const why = renderReasons(row.reasons);

          return (
            <li key={row.suggestion.id} className={styles.row}>
              {/* Decorative -- the row's accessible name is the song, not the rank. */}
              <span className={styles.rank} aria-hidden="true">
                {row.rank}
              </span>
              <div className={styles.info}>
                <p className={styles.title}>
                  {title} <span className={styles.artist}>— {artist}</span>
                  {isMustPlay && <span className={styles.mustPlayPill}>Must-play</span>}
                </p>
                <p className={styles.votes}>
                  {row.suggestion.requesters} {row.suggestion.requesters === 1 ? 'request' : 'requests'}
                </p>
                {why && <p className={styles.why}>{why}</p>}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.playButton}
                  aria-label={`Play ${title}`}
                  onClick={() => {
                    // Inert by design (Task 16 scope note) -- `playSuggestion`
                    // doesn't exist until the next task.
                  }}
                >
                  Play
                </button>
                <button
                  type="button"
                  className={styles.skipButton}
                  aria-label={`Skip ${title}`}
                  onClick={() => {
                    // Inert by design (Task 16 scope note) -- `skipSuggestion`
                    // doesn't exist until the next task.
                  }}
                >
                  Skip
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
