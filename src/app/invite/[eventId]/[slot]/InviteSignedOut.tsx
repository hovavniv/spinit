import Link from 'next/link';

import styles from './page.module.css';

interface InviteSignedOutProps {
  eventId: string;
  slot: '1' | '2';
}

/**
 * What a signed-out visitor to an invite link sees instead of the claim form
 * (design §4.4, §4.6). Both links carry `?invite={eventId}&slot={slot}`
 * forward: the log-in link so `signInWithPassword` can redirect straight back
 * here (design §9.3, closed), and the register link so the register page
 * renders in partner mode instead of the DJ form.
 *
 * Plain Server Component -- no client state, no action, just two links.
 */
export function InviteSignedOut({ eventId, slot }: InviteSignedOutProps) {
  return (
    <div>
      <p className={styles.note}>
        Log in, or create an account with the email address your DJ invited.
      </p>
      <Link href={`/register?invite=${eventId}&slot=${slot}`} className={styles.primary}>
        Create an account
      </Link>
      <p className={styles.note}>
        Already have an account?{' '}
        <Link href={`/login?invite=${eventId}&slot=${slot}`} className={styles.link}>
          Log in
        </Link>
      </p>
    </div>
  );
}
