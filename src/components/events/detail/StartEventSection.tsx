'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { EventPhase } from '@/lib/dashboard/types';
import type { LiveActionResult } from '@/lib/live/liveActions';
import { START_PHASE } from '@/lib/live/phaseSegment';
import styles from './StartEventSection.module.css';

interface StartEventSectionProps {
  eventId: string;
  /**
   * Computed by the SERVER component that renders this (design §5.2b), the
   * same way `canEnd` is: `isDj && status === 'upcoming' && event_date >=
   * todayInAppTimezone()`. Never evaluated here -- a Client Component reads
   * the VIEWER'S BROWSER timezone, a third clock after the two the lifecycle
   * rule already reconciles, and would be wrong for a DJ working away from
   * home.
   */
  canStart: boolean;
  startEventAction: (eventId: string, phase: EventPhase) => Promise<LiveActionResult>;
}

/**
 * The Start button EventDetailScreen renders beside EndEventSection. On
 * success it navigates to `/events/[id]/live`, which is where the guest QR
 * modal lives once the event is live (§5.2a) -- pressing Start is how a DJ
 * actually reaches the screen this whole slice is about.
 */
export function StartEventSection({ eventId, canStart, startEventAction }: StartEventSectionProps) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canStart) return null;

  async function handleStart() {
    setStarting(true);
    setError(null);
    const result = await startEventAction(eventId, START_PHASE);
    if (result.ok) {
      router.push(`/events/${eventId}/live`);
      return;
    }
    setStarting(false);
    setError("Couldn't start the event — try again in a moment.");
  }

  return (
    <div className={styles.section}>
      {error && <p className={styles.error}>{error}</p>}
      <button type="button" className={styles.start} disabled={starting} onClick={handleStart}>
        {starting ? 'Starting…' : 'Start event'}
      </button>
    </div>
  );
}
