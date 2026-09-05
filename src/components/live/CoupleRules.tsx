import type { BlocklistRow, MustPlayRow } from '@/lib/events/detailTypes';
import type { PlayedTrack } from '@/lib/live/liveTypes';
import styles from './CoupleRules.module.css';

/**
 * Three columns (design §7.1): unplayed must-plays, played must-plays, and
 * the do-not-play list. The "Played" column is derived from `played`, not
 * from any client-side-only state -- that is what makes a must-play "turn
 * green" durably across a page refresh (design §7.1, load-bearing per Task
 * 16's brief).
 */
export function CoupleRules({
  mustPlay,
  blocklist,
  played,
  mustPlayProgress,
}: {
  mustPlay: MustPlayRow[];
  blocklist: BlocklistRow[];
  played: PlayedTrack[];
  mustPlayProgress: { played: number; total: number };
}) {
  const playedTrackIds = new Set(
    played.map((p) => p.spotifyTrackId).filter((id): id is string => id !== null),
  );
  const isPlayed = (row: MustPlayRow) =>
    row.spotify_track_id !== null && playedTrackIds.has(row.spotify_track_id);

  const unplayedMustPlays = mustPlay.filter((row) => !isPlayed(row));
  const playedMustPlays = mustPlay.filter(isPlayed);

  const pct =
    mustPlayProgress.total === 0
      ? 0
      : Math.round((mustPlayProgress.played / mustPlayProgress.total) * 100);

  return (
    <section className={styles.section} aria-label="Couple's rules">
      <div className={styles.progressRow}>
        <span className={styles.progressLabel}>
          {mustPlayProgress.played}/{mustPlayProgress.total} must-plays played
        </span>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          <h3 className={styles.columnHeading}>Must play</h3>
          <ul className={styles.list}>
            {unplayedMustPlays.length === 0 && <li className={styles.empty}>All played</li>}
            {unplayedMustPlays.map((row) => (
              <li key={row.id}>
                {row.title}
                {row.artist ? ` — ${row.artist}` : ''}
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.column}>
          <h3 className={styles.columnHeading}>Played</h3>
          <ul className={styles.list}>
            {playedMustPlays.length === 0 && <li className={styles.empty}>None yet</li>}
            {playedMustPlays.map((row) => (
              <li key={row.id} className={styles.played}>
                {row.title}
                {row.artist ? ` — ${row.artist}` : ''}
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.column}>
          <h3 className={styles.columnHeading}>Do not play</h3>
          <ul className={styles.list}>
            {blocklist.length === 0 && <li className={styles.empty}>None</li>}
            {blocklist.map((row) => (
              <li key={row.id}>{row.value}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
