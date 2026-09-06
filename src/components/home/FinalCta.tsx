import Link from 'next/link';
import styles from './FinalCta.module.css';

/**
 * The dark closing band. Anchor: design/artboards/Spinit Homepage.dc.html,
 * the <!-- FINAL CTA --> block.
 *
 * DEVIATION: the artboard's second button reads "Talk to us" and points at
 * #get-started -- an id that exists nowhere in the app, so the button was inert.
 * There is no contact page to send it to, so it became the sign-in route that
 * the homepage was otherwise missing entirely.
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
        <Link href="/login" className={styles.secondaryCta}>
          Log in
        </Link>
      </div>
    </section>
  );
}
