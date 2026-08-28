import Link from 'next/link';
import styles from './Hero.module.css';
import { HeroPhoneDemo } from './HeroPhoneDemo';

/**
 * The headline, copy, CTAs, and the phone frame chrome. Anchor:
 * design/artboards/Spinit Homepage.dc.html, the <!-- HERO --> block.
 *
 * The phone frame's interactive interior (the guest/DJ demo) is
 * `HeroPhoneDemo`, a client component rendered directly here — Hero itself
 * stays a server component since Next's server/client boundary handles a
 * direct import of a client child fine.
 */
export function Hero() {
  return (
    <section className={styles.hero}>
      <div>
        <div className={styles.badge}>Built for wedding DJs</div>
        <h1 className={styles.headline}>The dance floor requests. You decide.</h1>
        <p className={styles.copy}>
          Spinit lets guests suggest and vote on songs from their own phones, learns the couple&apos;s
          taste before the big day, and hands you a ranked queue that explains every pick.
        </p>
        <div className={styles.ctaRow}>
          <Link href="/register" className={styles.primaryCta}>
            Get Spinit free
          </Link>
          <a href="#how-it-works" className={styles.secondaryCta}>
            See how it works →
          </a>
        </div>
      </div>

      <div className={styles.phoneColumn}>
        <div className={styles.decorCircleBlue} aria-hidden="true" />
        <div className={styles.decorCirclePink} aria-hidden="true" />

        <div className={styles.phoneFrame}>
          <div className={styles.phoneNotch} />
          <div className={styles.phoneScreen}>
            <HeroPhoneDemo />
          </div>
        </div>
      </div>
    </section>
  );
}
