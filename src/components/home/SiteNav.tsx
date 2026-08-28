import { Logo } from '@/components/brand/Logo';
import styles from './SiteNav.module.css';

/**
 * The sticky top bar. Anchor: design/artboards/Spinit Homepage.dc.html,
 * the <!-- NAV --> block.
 */
export function SiteNav() {
  return (
    <header className={styles.nav}>
      <Logo tone="dark" />
      <nav className={styles.links}>
        <a href="#how-it-works" className={styles.link}>
          How it works
        </a>
        <a href="#recap" className={styles.link}>
          Recap
        </a>
        <a href="#get-started" className={styles.cta}>
          Get Spinit
        </a>
      </nav>
    </header>
  );
}
