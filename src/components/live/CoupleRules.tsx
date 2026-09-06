import { PHASE_LABELS, type EventPhase } from '@/lib/dashboard/types';
import type { BlocklistRow, MustPlayRow } from '@/lib/events/detailTypes';
import type { PlayedTrack } from '@/lib/live/liveTypes';
import { PHASE_SEGMENT } from '@/lib/live/phaseSegment';
import styles from './CoupleRules.module.css';

/**
 * Three cards (design §7.1): unplayed must-plays, played must-plays, and the
 * do-not-play list. The "Played" card is derived from `played`, not from any
 * client-side-only state -- that is what makes a must-play stay marked played
 * durably across a page refresh (design §7.1, load-bearing per Task 16's
 * brief).
 *
 * `mustPlay` and `blocklist` are scoped to `phase`'s segment here, the same
 * way rank.ts scopes them for the engine (2026-09-06 bugfix): a `party`
 * blocklist row must not read as active during Reception just because the
 * engine already knows to ignore it. Ceremony must-plays never match either
 * segment and correctly disappear from this panel -- CeremonyCues already
 * renders them.
 */
export function CoupleRules({
  mustPlay,
  blocklist,
  played,
  // Not read directly: the poll route's `mustPlayProgress` is a whole-evening
  // count across every segment (design §6.2-i), not scoped to `phase`. See
  // `scopedProgress` below, which derives the DISPLAYED figure from the same
  // scoped list the cards render, so the panel never shows a card row next
  // to a progress figure that disagrees with it. Kept in the prop list (and
  // still passed by every caller) so this component's contract does not
  // silently diverge from LiveHeader's, which DOES want the whole-evening
  // figure.
  phase,
}: {
  mustPlay: MustPlayRow[];
  blocklist: BlocklistRow[];
  played: PlayedTrack[];
  phase: EventPhase;
}) {
  const segment = PHASE_SEGMENT[phase];
  const scopedMustPlay = mustPlay.filter((row) => row.segment === segment);
  const scopedBlocklist = blocklist.filter((row) => row.segment === segment);

  const playedTrackIds = new Set(
    played.map((p) => p.spotifyTrackId).filter((id): id is string => id !== null),
  );
  const isPlayed = (row: MustPlayRow) =>
    row.spotify_track_id !== null && playedTrackIds.has(row.spotify_track_id);

  const unplayedMustPlays = scopedMustPlay.filter((row) => !isPlayed(row));
  const playedMustPlays = scopedMustPlay.filter(isPlayed);

  const scopedProgress = {
    played: playedMustPlays.length,
    total: scopedMustPlay.length,
  };
  const pct =
    scopedProgress.total === 0
      ? 0
      : Math.round((scopedProgress.played / scopedProgress.total) * 100);

  return (
    <section className={styles.section} aria-label="Couple's rules">
      <div className={styles.headerRow}>
        <div>
          <h2 className={styles.heading}>Couple&apos;s rules</h2>
          <p className={styles.subhead}>Must-plays are ticked off as they play.</p>
        </div>
        <div className={styles.progress}>
          <div className={styles.progressRow}>
            <span>{PHASE_LABELS[phase]} must-plays covered</span>
            <span className={styles.progressFigure}>
              {scopedProgress.played}/{scopedProgress.total}
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
            <span className={styles.count}>{scopedBlocklist.length}</span>
          </div>
          <div className={styles.cardBody}>
            {scopedBlocklist.length === 0 && <p className={styles.empty}>Nothing here yet.</p>}
            {scopedBlocklist.map((row) => (
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
