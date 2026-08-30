import type { CoupleStatus } from '@/lib/dashboard/types';
import styles from './StreamingSection.module.css';

interface StreamingSectionProps {
  coupleStatus: CoupleStatus;
}

/**
 * The artboard's streaming-profiles block and taste-analysis block, kept in
 * their drawn container but with honest copy: no streaming integration exists,
 * so the artboard's fixture numbers (84% match, five shared artists) are not
 * rendered as though they were real (design §7.2, scope).
 *
 * The one real fact available is events.couple_status, which the dashboard's
 * upcoming cards already show.
 */
export function StreamingSection({ coupleStatus }: StreamingSectionProps) {
  const connected = coupleStatus === 'streaming-connected';

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Connect streaming profiles</h2>
      <p className={styles.blurb}>
        Each partner connects their own service from their invite — Spotify, Apple Music, or
        whatever they use.
      </p>

      <div className={styles.statusRow}>
        <div>
          <div className={styles.statusTitle}>The couple&rsquo;s profiles</div>
          <div className={styles.statusDetail}>
            {connected
              ? 'Both partners have connected a music profile.'
              : 'Neither partner has connected a profile yet.'}
          </div>
        </div>
        <span className={connected ? styles.pillConnected : styles.pillAwaiting}>
          {connected ? 'Streaming connected' : 'Awaiting couple'}
        </span>
      </div>

      <div className={styles.comingSoon}>
        <strong className={styles.comingSoonLabel}>Coming soon</strong> — sending the invite and
        connecting a streaming service are not built yet. Once both partners connect, the taste
        analysis appears here: a first read on what they love, straight from their own libraries.
      </div>
    </section>
  );
}
