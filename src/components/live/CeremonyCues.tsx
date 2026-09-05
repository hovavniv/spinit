'use client';

import { CEREMONY_SLOTS } from '@/lib/events/ceremonySlots';
import type { MustPlayRow } from '@/lib/events/detailTypes';
import type { PlayedTrack } from '@/lib/live/liveTypes';
import styles from './CeremonyCues.module.css';

/**
 * The two fixed ceremony cues (design §7.1, §7.3), matched against
 * `mustPlay` rows where `segment === 'ceremony'` by `moment`. A slot can be
 * unfilled -- the DJ hasn't picked a song for it yet.
 *
 * "Play now" is inert by design (Task 16 scope note): it will eventually call
 * `playPick`, which does not exist until a later task.
 */
export function CeremonyCues({ mustPlay, played }: { mustPlay: MustPlayRow[]; played: PlayedTrack[] }) {
  const playedTrackIds = new Set(
    played.map((p) => p.spotifyTrackId).filter((id): id is string => id !== null),
  );

  return (
    <section className={styles.section} aria-label="Ceremony cues">
      <h2 className={styles.heading}>Ceremony</h2>
      <ul className={styles.list}>
        {CEREMONY_SLOTS.map((slot) => {
          const row = mustPlay.find((m) => m.segment === 'ceremony' && m.moment === slot.moment);
          const isPlayed = row?.spotify_track_id != null && playedTrackIds.has(row.spotify_track_id);

          return (
            <li key={slot.moment} className={styles.row}>
              <span className={styles.label}>{slot.label}</span>
              {row ? (
                <span className={styles.song}>
                  {row.title}
                  {row.artist ? ` — ${row.artist}` : ''}
                </span>
              ) : (
                <span className={styles.unfilled}>No song set</span>
              )}
              {row && !isPlayed && (
                <button
                  type="button"
                  className={styles.playNow}
                  aria-label={`Play now: ${row.title}`}
                  onClick={() => {
                    // Inert by design (Task 16 scope note) -- `playPick`
                    // doesn't exist until a later task.
                  }}
                >
                  Play now
                </button>
              )}
              {isPlayed && <span className={styles.playedBadge}>Played</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
