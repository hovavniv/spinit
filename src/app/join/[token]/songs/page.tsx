import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { joinTokenParamSchema } from '@/lib/live/liveValidation';
import { getGuestSessionId } from '@/lib/guest/session';
import { readGuestQueue } from '@/lib/live/guestDal';
import { suggestAction, voteAction } from '@/lib/live/guestActions';
import { GuestPicker } from '@/components/guest/GuestPicker';
import { GuestQueue } from '@/components/guest/GuestQueue';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Pick a song — Spinit',
};

/**
 * `/join/[token]/songs` — the picker (design §7.3, the artboard). A guest
 * with no session for this token is sent back to `/join/[token]` to join
 * first -- but a token that fails the `^[A-Za-z0-9]{22}$` shape check gets
 * `notFound()` instead, never a redirect (design §10.5's per-role test
 * makes this distinction explicit: shape-invalid is a different case from
 * shape-valid-but-no-session).
 *
 * F2: on `no_such_session`/`wrong_event`, this Server Component does NOT
 * clear the cookie itself -- Next 16 permits `cookies().delete()` only from
 * a Server Function or Route Handler, and calling it during a Server
 * Component's render throws `ReadonlyRequestCookiesError` instead of
 * clearing anything, so the guest landed on the error boundary and the
 * stale cookie survived, repeating the same failure on every reload. This
 * just redirects to `/join/[token]`; that page's own `guest_join` call is
 * where a stale/invalid session is naturally discovered and superseded by
 * the NEW cookie a successful re-join sets.
 */
export default async function SongsPage({ params }: PageProps<'/join/[token]/songs'>) {
  const { token } = await params;

  if (!joinTokenParamSchema.safeParse(token).success) notFound();

  const sessionId = await getGuestSessionId(token);
  if (!sessionId) redirect(`/join/${token}`);

  const queueState = await readGuestQueue(sessionId);

  if (!queueState.ok) {
    if (queueState.code === 'no_such_session' || queueState.code === 'wrong_event') {
      redirect(`/join/${token}`);
    }
    return (
      <main className={styles.wrap}>
        <p className={styles.brand}>Spinit</p>
        <p className={styles.message}>{queueState.message}</p>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <p className={styles.brand}>Spinit</p>
      <h1 className={styles.title}>Pick a song</h1>

      <GuestPicker
        token={token}
        usedCount={queueState.data.usedCount}
        suggestAction={suggestAction}
      />

      <GuestQueue token={token} queue={queueState.data.queue} voteAction={voteAction} />
    </main>
  );
}
