import type { RankedSong } from '@/lib/live/liveTypes';
import { renderReasons } from '@/lib/live/reasons';
import styles from './BlockedGroup.module.css';

/**
 * Blocked suggestions, collapsed under the queue (design §7.1). `row.blocked`
 * is a single `Reason`, not an array -- wrapped before passing to
 * `renderReasons` so its "why" text is never silently dropped.
 *
 * A native `<details>`/`<summary>` gives a collapsible group with no JS state
 * needed, and is accessible by default.
 */
export function BlockedGroup({ blocked }: { blocked: RankedSong[] }) {
  if (blocked.length === 0) return null;

  return (
    <details className={styles.details} open>
      <summary className={styles.summary}>Blocked ({blocked.length})</summary>
      <ul className={styles.list}>
        {blocked.map((row) => {
          const title = row.suggestion.resolvedTitle ?? row.suggestion.title;
          const artist = row.suggestion.resolvedArtist ?? row.suggestion.artist;
          const why = renderReasons(row.blocked ? [row.blocked] : []);

          return (
            <li key={row.suggestion.id} className={styles.row}>
              <span className={styles.title}>
                {title} — {artist}
              </span>
              {why && <span className={styles.reason}>{why}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
