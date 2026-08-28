import styles from './RecordMark.module.css';

/**
 * The small spinning vinyl record used next to the "Spinit" wordmark.
 * Anchor: design/artboards/Spinit Homepage.dc.html, the <!-- NAV --> block
 * (identical markup also appears in Spinit DJ Login.dc.html's brand panel).
 * Purely decorative — hidden from assistive tech.
 */
export function RecordMark() {
  return (
    <div className={styles.record} aria-hidden="true">
      <div className={styles.ringOuter} />
      <div className={styles.ringInner} />
      <div className={styles.centerDot} />
      <div className={styles.centerHole} />
    </div>
  );
}
