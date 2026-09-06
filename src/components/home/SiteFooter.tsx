import Link from 'next/link';
import styles from './SiteFooter.module.css';

/**
 * Anchor: design/artboards/Spinit Homepage.dc.html, the <!-- FOOTER --> block.
 */
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div>
        <div className={styles.brand}>Spinit</div>
        <div className={styles.tagline}>Song requests and voting for wedding DJs.</div>
      </div>
      <nav className={styles.links}>
        <a href="#how-it-works" className={styles.link}>
          How it works
        </a>
        <a href="#recap" className={styles.link}>
          Recap
        </a>
        <Link href="/login" className={styles.link}>
          Log in
        </Link>
      </nav>
      <div className={styles.copyright}>© 2026 Spinit</div>
    </footer>
  );
}
