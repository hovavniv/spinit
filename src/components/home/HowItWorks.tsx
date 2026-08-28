import styles from './HowItWorks.module.css';

/**
 * "Three roles. One queue." — the three role cards. Anchor:
 * design/artboards/Spinit Homepage.dc.html, the <!-- HOW IT WORKS --> block.
 */
export function HowItWorks() {
  return (
    <section id="how-it-works" className={styles.section}>
      <div className={styles.intro}>
        <h2 className={styles.heading}>Three roles. One queue.</h2>
        <p className={styles.subheading}>
          Every request, vote, and rule feeds the same ranked list — you just have to glance at it.
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={`${styles.kicker} ${styles.kickerDj}`}>01 · THE DJ</div>
          <h3 className={styles.cardTitle}>You run the show</h3>
          <p className={styles.cardCopy}>
            Before you even meet the couple, Spinit asks for access to their streaming profiles and
            hands you a taste report. From there, every request, blacklist entry, and phase change
            feeds a ranking that explains itself — not just a queue.
          </p>
          <div className={styles.djExample}>
            <div className={styles.djExampleChip}>1</div>
            <span className={styles.djExampleTitle}>Uptown Funk</span>
            <span className={styles.djExampleMeta}>— 24 requests, must-play match</span>
          </div>
        </div>

        <div className={styles.card}>
          <div className={`${styles.kicker} ${styles.kickerCouple}`}>02 · THE COUPLE</div>
          <h3 className={styles.cardTitle}>They set the boundaries</h3>
          <p className={styles.cardCopy}>
            In your planning session, lock in the must-plays, the do-not-plays, and the first dance —
            by song or by genre. They can keep editing the list from the app right up until the
            wedding.
          </p>
          <div className={styles.couplePills}>
            <span className={styles.pillFilled}>Must play: Perfect</span>
            <span className={styles.pillOutline}>Do not play: Cha Cha Slide</span>
          </div>
        </div>

        <div className={styles.card}>
          <div className={`${styles.kicker} ${styles.kickerGuests}`}>03 · THE GUESTS</div>
          <h3 className={styles.cardTitle}>The room requests itself</h3>
          <p className={styles.cardCopy}>
            A QR code on the table opens a login-free page tied to the guest list, so only people at
            the wedding can weigh in. Three requests per guest, unlimited votes — a duplicate request
            just adds a vote instead of clutter.
          </p>
          <div className={styles.guestPills}>
            <span className={styles.pillVotes}>
              <span className={styles.pillVotesHeart}>♥</span> 12 votes
            </span>
            <span className={styles.pillUsed}>3/3 requests used</span>
          </div>
        </div>
      </div>
    </section>
  );
}
