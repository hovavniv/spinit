'use client';

import { useState } from 'react';

import type { VoteActionResult } from '@/lib/live/guestActions';
import styles from './GuestQueue.module.css';

export interface GuestQueueItem {
  suggestionId: string;
  title: string;
  artist: string;
  votes: number;
  voted: boolean;
  mine: boolean;
}

/**
 * The ranked pending list on the guest's picker (design §7.3). Server-side
 * order (votes desc, created_at, id) is never re-sorted here.
 *
 * Rank badge is decorative -- the row's accessible name is the song and
 * artist text (design §7.6), not the badge. The backing button is a real
 * `<button>` with `aria-pressed`, 44px minimum tap target, and once backed
 * does not fire a second RPC call on a repeat tap -- a vote is a person,
 * and `unique(suggestion_id, guest_id)` makes repeat taps pointless.
 */
export function GuestQueue({
  sessionId,
  queue,
  voteAction,
}: {
  sessionId: string;
  queue: GuestQueueItem[];
  voteAction: (sessionId: string, suggestionId: string) => Promise<VoteActionResult>;
}) {
  const [optimisticVoted, setOptimisticVoted] = useState<Set<string>>(new Set());

  async function handleBack(suggestionId: string, alreadyVoted: boolean) {
    if (alreadyVoted) return;
    setOptimisticVoted((prev) => new Set(prev).add(suggestionId));
    await voteAction(sessionId, suggestionId);
  }

  if (queue.length === 0) {
    return <p className={styles.empty}>Nothing queued yet — be first.</p>;
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.title}>Request queue {queue.length}</p>
      {queue.map((item, index) => {
        const voted = item.voted || optimisticVoted.has(item.suggestionId);
        const rank = index + 1;
        const accessibleName = `${item.title} by ${item.artist}`;
        return (
          <div key={item.suggestionId} className={`${styles.row} ${voted ? styles.rowBacked : ''}`}>
            <span className={`${styles.badge} ${rank === 1 ? styles.badgeTop : ''}`} aria-hidden="true">
              {rank}
            </span>
            <div className={styles.text}>
              <p className={styles.songTitle}>{accessibleName}</p>
              <p className={styles.meta}>
                {item.votes} {item.votes === 1 ? 'person' : 'people'} asked
                {voted ? ' · you backed it' : ''}
              </p>
            </div>
            <button
              type="button"
              className={`${styles.backButton} ${voted ? styles.backButtonActive : ''}`}
              aria-pressed={voted}
              aria-label={voted ? `Backed ${accessibleName}` : `Back ${accessibleName}`}
              disabled={voted}
              onClick={() => handleBack(item.suggestionId, voted)}
            >
              {voted ? 'Backed ✓' : 'Back it'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
