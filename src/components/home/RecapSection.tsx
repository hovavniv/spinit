import styles from './RecapSection.module.css';

/**
 * "A playlist they'll actually keep." + the receipt card. Anchor:
 * design/artboards/Spinit Homepage.dc.html, the <!-- RECAP --> block.
 */
export function RecapSection() {
  return (
    <section id="recap" className={styles.section}>
      <div>
        <h2 className={styles.heading}>A playlist they&apos;ll actually keep.</h2>
        <p className={styles.copy}>
          When the last song ends, the couple gets the whole night back — every track, in order, with
          who asked for it.
        </p>
      </div>
      <div className={styles.card}>
        <div className={styles.perforationTop} aria-hidden="true" />
        <div className={styles.cardTitle}>Maya &amp; Tomer — Final Set</div>
        <div className={styles.cardMeta}>5 songs · closed 12:48 AM</div>
        <div className={styles.list}>
          <div className={styles.row}>
            <div>
              <span className={styles.rowTitle}>1. Perfect</span>{' '}
              <span className={styles.rowArtist}>— Ed Sheeran</span>
            </div>
            <span className={styles.rowNoteAccent}>First dance</span>
          </div>
          <div className={styles.row}>
            <div>
              <span className={styles.rowTitle}>2. Uptown Funk</span>{' '}
              <span className={styles.rowArtist}>— Bruno Mars</span>
            </div>
            <span className={styles.rowNote}>24 guests</span>
          </div>
          <div className={styles.row}>
            <div>
              <span className={styles.rowTitle}>3. September</span>{' '}
              <span className={styles.rowArtist}>— Earth, Wind &amp; Fire</span>
            </div>
            <span className={styles.rowNote}>19 guests</span>
          </div>
          <div className={styles.row}>
            <div>
              <span className={styles.rowTitle}>4. Levitating</span>{' '}
              <span className={styles.rowArtist}>— Dua Lipa</span>
            </div>
            <span className={styles.rowNote}>requested by Noa</span>
          </div>
          <div className={styles.row}>
            <div>
              <span className={styles.rowTitle}>5. Don&apos;t Stop Believin&apos;</span>{' '}
              <span className={styles.rowArtist}>— Journey</span>
            </div>
            <span className={styles.rowNote}>requested by Tomer&apos;s dad</span>
          </div>
        </div>
        <div className={styles.perforationBottom} aria-hidden="true" />
      </div>
    </section>
  );
}
