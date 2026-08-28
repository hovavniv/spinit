import Link from 'next/link';
import styles from './FinalCta.module.css';

/**
 * The dark closing band. Anchor: design/artboards/Spinit Homepage.dc.html,
 * the <!-- FINAL CTA --> block.
 */
export function FinalCta() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        Give your next wedding a soundtrack the room actually chose.
      </h2>
      <div className={styles.ctaRow}>
        <Link href="/register" className={styles.primaryCta}>
          Get Spinit free
        </Link>
        <a href="#get-started" className={styles.secondaryCta}>
          Talk to us
        </a>
      </div>
    </section>
  );
}
