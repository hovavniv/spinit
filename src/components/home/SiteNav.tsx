import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import styles from './SiteNav.module.css';

/**
 * The sticky top bar. Anchor: design/artboards/Spinit Homepage.dc.html,
 * the <!-- NAV --> block.
 *
 * DEVIATION: the artboard's nav has no "Log in" -- it offers only "Get Spinit",
 * which goes to /register. That leaves a returning DJ with no way into the app
 * from the homepage short of typing the URL, so the link is added here and in
 * the footer. It reuses .link rather than introducing a second pill, so the
 * artboard's single-CTA emphasis survives.
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
        <Link href="/login" className={styles.link}>
          Log in
        </Link>
        <Link href="/register" className={styles.cta}>
          Get Spinit
        </Link>
      </nav>
    </header>
  );
}
