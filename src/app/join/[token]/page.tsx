import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { joinTokenParamSchema } from '@/lib/live/liveValidation';
import { readGuestEvent } from '@/lib/live/guestDal';
import { joinAction } from '@/lib/live/guestActions';
import { JoinForm } from '@/components/guest/JoinForm';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Join the floor — Spinit',
};

/**
 * `/join/[token]` — the name screen (design §7.3, a deviation the artboard
 * does not show, Niv-approved 2026-09-04). No session is required to render
 * this page -- a guest hasn't joined yet, and this is where `guest_join` is
 * called for the first time, so it also doubles as the point a bad or
 * expired token is discovered.
 *
 * Deliberately austere: no sidebar, no DJ branding, no navigation.
 */
export default async function JoinPage({ params }: PageProps<'/join/[token]'>) {
  const { token } = await params;

  // Shape-checked BEFORE any use -- the database CHECK guarantees the shape
  // of tokens in the database, not of a segment a stranger typed into the
  // URL bar (design §4.5).
  if (!joinTokenParamSchema.safeParse(token).success) notFound();

  const eventInfo = await readGuestEvent(token);

  if (!eventInfo.ok) {
    return (
      <main className={styles.wrap}>
        <p className={styles.brand}>Spinit</p>
        <p className={styles.message}>{eventInfo.message}</p>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <p className={styles.brand}>Spinit</p>
        {eventInfo.data.isLive && <span className={styles.livePill}>Live now</span>}
      </div>

      <h1 className={styles.coupleNames}>{eventInfo.data.coupleNames}&rsquo;s floor</h1>

      {eventInfo.data.isLive ? (
        <JoinForm token={token} joinAction={joinAction} />
      ) : (
        <p className={styles.message}>This event hasn&rsquo;t started yet, or it&rsquo;s over.</p>
      )}
    </main>
  );
}
