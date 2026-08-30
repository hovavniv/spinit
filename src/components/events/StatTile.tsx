import styles from './StatTile.module.css';

interface StatTileProps {
  /** The small line beneath the value, e.g. 'Songs played'. */
  label: string;
  /**
   * The big Sora line. Omit it for the pending state — and note that `0` is a
   * real value, so the check is `undefined`, not falsiness.
   */
  value?: string | number;
  /** Why there is no value yet. Shown on hover and to assistive tech. */
  pendingReason?: string;
  /** grid-column: span 2, for the artboard's wide 'Most requested song' tile. */
  wide?: boolean;
}

/**
 * One stat tile from design/artboards/Spinit Event Recap.dc.html.
 *
 * Three of this screen's five tiles have no data behind them yet (design §5,
 * §7.3). Rather than dropping them — which would change the artboard's grid —
 * or inventing numbers, they render at full size with an em-dash and an
 * explanation. The explanation is in a visually-hidden span as well as the
 * `title`, because `title` is not reliably announced by screen readers and
 * never appears on touch.
 */
export function StatTile({ label, value, pendingReason, wide = false }: StatTileProps) {
  const pending = value === undefined;

  return (
    <div
      className={wide ? `${styles.tile} ${styles.wide}` : styles.tile}
      title={pending ? pendingReason : undefined}
    >
      <div className={pending ? styles.valuePending : styles.value}>
        {pending ? '—' : value}
        {pending && pendingReason && <span className="srOnly">{pendingReason}</span>}
      </div>
      <div className={styles.label}>{label}</div>
    </div>
  );
}
