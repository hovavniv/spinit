import styles from './Hero.module.css';

/**
 * The headline, copy, CTAs, and the phone frame chrome. Anchor:
 * design/artboards/Spinit Homepage.dc.html, the <!-- HERO --> block.
 *
 * The phone frame's interactive interior (the guest/DJ demo) is Task 6's
 * `HeroPhoneDemo` — this component only renders the frame chrome around it
 * with a static placeholder.
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
          <a id="get-started" href="#get-started" className={styles.primaryCta}>
            Get Spinit free
          </a>
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
            {/* HeroPhoneDemo (Task 6) slots in here. */}
            <div />
          </div>
        </div>
      </div>
    </section>
  );
}
