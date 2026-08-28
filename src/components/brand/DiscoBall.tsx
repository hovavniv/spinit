import styles from './DiscoBall.module.css';

/**
 * The disco ball hanging above the homepage hero.
 * Anchor: design/artboards/Spinit Homepage.dc.html, the
 * "DISCO BALL, hanging from the ceiling" block. Purely decorative.
 */
export function DiscoBall() {
  return (
    <div className={styles.wrapper} aria-hidden="true">
      <div className={styles.cord} />
      <div className={styles.ball}>
        <div className={styles.sparkleOne} />
        <div className={styles.sparkleTwo} />
      </div>
    </div>
  );
}
