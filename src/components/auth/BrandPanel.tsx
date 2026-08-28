import { Logo } from '@/components/brand/Logo';
import styles from './BrandPanel.module.css';

const features = [
  'A ranked queue that explains every pick',
  'Guest requests, no app download needed',
  'A full recap the couple keeps forever',
];

/**
 * The dark left half of the auth screen, from
 * design/artboards/Spinit DJ Login.dc.html, <!-- LEFT: BRAND PANEL -->.
 * Static — it does not change between login and register mode.
 */
export function BrandPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.blobPink} aria-hidden="true" />
      <div className={styles.blobIndigo} aria-hidden="true" />

      <div className={styles.brandRow}>
        <Logo tone="light" />
      </div>

      <div className={styles.copy}>
        <h1 className={styles.heading}>Run tonight&apos;s queue like a pro.</h1>
        <p className={styles.subheading}>
          Sign in to see live requests, ranked by demand and the couple&apos;s rules — or create an
          account to set up your first event.
        </p>

        <div className={styles.features}>
          {features.map((feature) => (
            <div key={feature} className={styles.feature}>
              <div className={styles.featureIcon} aria-hidden="true" />
              <span className={styles.featureText}>{feature}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.footer}>© 2026 Spinit</div>
    </div>
  );
}
