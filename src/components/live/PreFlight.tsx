'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { EventPhase } from '@/lib/dashboard/types';
import type { LiveActionResult } from '@/lib/live/liveActions';
import { PhasePicker } from './PhasePicker';
import styles from './PreFlight.module.css';

/**
 * Shown for an `upcoming` event on `/events/[id]/live` (design §5.2). Takes
 * `startEvent` as a prop rather than importing the real server action, the
 * same pattern LoginForm uses for its own action — it decouples the
 * component from the server module for testing and keeps the page (a Server
 * Component) as the one place that wires the real action in.
 *
 * No QR here, deliberately (Niv, 2026-09-04): "unable to start QR until the
 * event actually starts" — the token is minted by `startEvent` itself, so
 * there is nothing to encode before the event goes live.
 */
export function PreFlight({
  eventId,
  coupleNames,
  venue,
  eventDate,
  startEvent,
}: {
  eventId: string;
  coupleNames: string;
  venue: string;
  eventDate: string;
  startEvent: (eventId: string, phase: EventPhase) => Promise<LiveActionResult>;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<EventPhase>('cocktails');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setStarting(true);
    setError(null);
    const result = await startEvent(eventId, phase);
    if (result.ok) {
      router.refresh();
      return;
    }
    setStarting(false);
    setError("Couldn't start the event — try again in a moment.");
  }

  return (
    <div className={styles.card}>
      <p className={styles.coupleNames}>{coupleNames}</p>
      <p className={styles.meta}>
        {venue} · {eventDate}
      </p>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.phaseRow}>
        <span className={styles.label}>Starting phase</span>
        <PhasePicker value={phase} onChange={setPhase} disabled={starting} />
      </div>

      <button type="button" className={styles.startButton} disabled={starting} onClick={handleStart}>
        {starting ? 'Starting…' : 'Start event'}
      </button>

      <p className={styles.hint}>the guest QR code appears once you start</p>
    </div>
  );
}
