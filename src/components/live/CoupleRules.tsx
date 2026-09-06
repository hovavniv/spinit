import type { BlocklistRow, MustPlayRow } from '@/lib/events/detailTypes';
import type { PlayedTrack } from '@/lib/live/liveTypes';
import styles from './CoupleRules.module.css';

/**
 * Three cards (design §7.1): unplayed must-plays, played must-plays, and the
 * do-not-play list. The "Played" card is derived from `played`, not from any
 * client-side-only state -- that is what makes a must-play stay marked played
 * durably across a page refresh (design §7.1, load-bearing per Task 16's
 * brief).
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
      <div className={styles.headerRow}>
        <div>
          <h2 className={styles.heading}>Couple&apos;s rules</h2>
          <p className={styles.subhead}>Must-plays are ticked off as they play.</p>
        </div>
        <div className={styles.progress}>
          <div className={styles.progressRow}>
            <span>Must-plays covered</span>
            <span className={styles.progressFigure}>
              {mustPlayProgress.played}/{mustPlayProgress.total}
            </span>
          </div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardHeadingRow}>
            <span className={`${styles.dot} ${styles.dotMustPlay}`} />
            <h3 className={styles.cardHeading}>Must play</h3>
            <span className={styles.count}>{unplayedMustPlays.length}</span>
          </div>
          <div className={styles.cardBody}>
            {unplayedMustPlays.length === 0 && (
              <p className={styles.empty}>Nothing here yet.</p>
            )}
            {unplayedMustPlays.map((row) => (
              <div key={row.id} className={`${styles.row} ${styles.rowMustPlay}`}>
                <span className={`${styles.mark} ${styles.markMustPlay}`} aria-hidden="true" />
                <div className={styles.rowBody}>
                  <div className={`${styles.title} ${styles.titleMustPlay}`}>{row.title}</div>
                  {row.artist && <div className={styles.artist}>{row.artist}</div>}
                </div>
                <span className={styles.note}>Waiting</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeadingRow}>
            <span className={`${styles.dot} ${styles.dotPlayed}`} />
            <h3 className={styles.cardHeading}>Played</h3>
            <span className={styles.count}>{playedMustPlays.length}</span>
          </div>
          <div className={styles.cardBody}>
            {playedMustPlays.length === 0 && <p className={styles.empty}>Nothing here yet.</p>}
            {playedMustPlays.map((row) => (
              <div key={row.id} className={`${styles.row} ${styles.rowPlayed}`}>
                <span className={`${styles.mark} ${styles.markPlayed}`} aria-hidden="true">
                  ✓
                </span>
                <div className={styles.rowBody}>
                  <div className={`${styles.title} ${styles.titlePlayed}`}>{row.title}</div>
                  {row.artist && <div className={styles.artist}>{row.artist}</div>}
                </div>
                <span className={styles.note}>Played</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeadingRow}>
            <span className={`${styles.dot} ${styles.dotBlocked}`} />
            <h3 className={styles.cardHeading}>Do not play</h3>
            <span className={styles.count}>{blocklist.length}</span>
          </div>
          <div className={styles.cardBody}>
            {blocklist.length === 0 && <p className={styles.empty}>Nothing here yet.</p>}
            {blocklist.map((row) => (
              <div key={row.id} className={`${styles.row} ${styles.rowBlocked}`}>
                <span className={`${styles.mark} ${styles.markBlocked}`} aria-hidden="true">
                  ✕
                </span>
                <div className={styles.rowBody}>
                  <div className={`${styles.title} ${styles.titleBlocked}`}>{row.value}</div>
                </div>
                <span className={styles.note}>Blocked</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
