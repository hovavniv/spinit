import { RecordMark } from './RecordMark';
import styles from './Logo.module.css';

type LogoTone = 'dark' | 'light';
type LogoSize = 'md' | 'sm';

interface LogoProps {
  /**
   * 'dark' — ink-coloured wordmark, for the light nav
   * (design/artboards/Spinit Homepage.dc.html, <!-- NAV -->).
   * 'light' — white wordmark, for the dark brand panel
   * (design/artboards/Spinit DJ Login.dc.html, <!-- LEFT: BRAND PANEL -->).
   */
  tone?: LogoTone;
  /**
   * 'md' — the current 22px wordmark, for existing call sites (the homepage
   * nav and the auth brand panel). 'sm' — 20px wordmark, for the dashboard
   * sidebar (design/artboards/Spinit DJ Dashboard.dc.html). The record mark
   * does not change size at either value.
   */
  size?: LogoSize;
}

export function Logo({ tone = 'dark', size = 'md' }: LogoProps) {
  return (
    <div className={styles.logo}>
      <RecordMark />
      <span
        className={`${styles.wordmark} ${tone === 'light' ? styles.light : styles.dark} ${
          size === 'sm' ? styles.sm : ''
        }`}
      >
        Spinit
      </span>
    </div>
  );
}
