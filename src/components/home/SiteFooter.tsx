import styles from './SiteFooter.module.css';

/**
 * Anchor: design/artboards/Spinit Homepage.dc.html, the <!-- FOOTER --> block.
 *
 * The artboard's footer carries "How it works" and "Recap" repeats of the nav
 * links. Dropped: they duplicated the sticky nav two screens further down, and
 * the sign-in route they sat beside is already in the nav and the closing band.
 */
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div>
        <div className={styles.brand}>Spinit</div>
        <div className={styles.tagline}>Song requests and voting for wedding DJs.</div>
      </div>
      <div className={styles.copyright}>© 2026 Spinit</div>
    </footer>
  );
}
