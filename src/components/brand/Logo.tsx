import { RecordMark } from './RecordMark';
import styles from './Logo.module.css';

type LogoTone = 'dark' | 'light';

interface LogoProps {
  /**
   * 'dark' — ink-coloured wordmark, for the light nav
   * (design/artboards/Spinit Homepage.dc.html, <!-- NAV -->).
   * 'light' — white wordmark, for the dark brand panel
   * (design/artboards/Spinit DJ Login.dc.html, <!-- LEFT: BRAND PANEL -->).
   */
  tone?: LogoTone;
}

export function Logo({ tone = 'dark' }: LogoProps) {
  return (
    <div className={styles.logo}>
      <RecordMark />
      <span className={`${styles.wordmark} ${tone === 'light' ? styles.light : styles.dark}`}>
        Spinit
      </span>
    </div>
  );
}
