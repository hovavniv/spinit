'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { EventPhase } from '@/lib/dashboard/types';
import type { BlocklistRow, MustPlayRow } from '@/lib/events/detailTypes';
import type { PlayedTrack, RankedSong } from '@/lib/live/liveTypes';
import type { LiveActionResult } from '@/lib/live/liveActions';
import { LiveHeader } from './LiveHeader';
import { CeremonyCues } from './CeremonyCues';
import { RequestQueue } from './RequestQueue';
import { BlockedGroup } from './BlockedGroup';
import { CoupleRules } from './CoupleRules';
import { GuestActivity, type LiveActivityItem } from './GuestActivity';
import { useLivePoll } from './useLivePoll';
import styles from './LiveScreen.module.css';

export interface LiveScreenProps {
  eventId: string;
  coupleNames: string;
  venue: string;
  /** 'YYYY-MM-DD'. */
  eventDate: string;
  /** 'HH:mm', Asia/Jerusalem wall clock (liveActions.ts). */
  startTime: string;
  /** ISO instant, the poll route's `now` -- never read from the browser clock. */
  now: string;
  phase: EventPhase;
  /**
   * Taken as a prop rather than imported directly, the same pattern PreFlight
   * uses for `startEvent` -- decouples this component from the server module
   * for testing, and keeps the page (a Server Component) as the one place
   * that wires the real action in.
   */
  setPhase: (eventId: string, phase: EventPhase) => Promise<LiveActionResult>;
  queue: RankedSong[];
  blocked: RankedSong[];
  mustPlay: MustPlayRow[];
  blocklist: BlocklistRow[];
  played: PlayedTrack[];
  mustPlayProgress: { played: number; total: number };
  /** Always `[]` for now (Task 16 scope note) -- Task 24 fills this in. */
  activity: LiveActivityItem[];
}

/**
 * The DJ's main working view once an event is live (design §7.1). Assembles,
 * top to bottom: LiveHeader, CeremonyCues, RequestQueue, BlockedGroup,
 * CoupleRules, GuestActivity.
 *
 * Driven entirely by props/initial data -- it does not own a fetch loop
 * itself, so a later task can wrap it in an 8-second polling hook without
 * restructuring it (Task 16 scope note).
 */
export function LiveScreen({
  eventId,
  coupleNames,
  venue,
  eventDate,
  startTime,
  now,
  phase,
  setPhase,
  queue,
  blocked,
  mustPlay,
  blocklist,
  played,
  mustPlayProgress,
  activity,
}: LiveScreenProps) {
  const router = useRouter();
  const [currentPhase, setCurrentPhase] = useState<EventPhase>(phase);
  const { state: polled, reconnecting } = useLivePoll(eventId, {
    queue,
    blocked,
    activity,
    mustPlayProgress,
    unresolvedArtistIds: [],
    now,
  });

  async function handlePhaseChange(next: EventPhase) {
    const previous = currentPhase;
    setCurrentPhase(next);
    const result = await setPhase(eventId, next);
    if (!result.ok) {
      // Revert the optimistic update rather than leaving the picker showing
      // a phase the write never actually committed.
      setCurrentPhase(previous);
      return;
    }
    router.refresh();
  }

  return (
    <div className={styles.screen}>
      {reconnecting && (
        <p className={styles.reconnecting} role="status">
          Reconnecting…
        </p>
      )}
      <LiveHeader
        coupleNames={coupleNames}
        venue={venue}
        eventDate={eventDate}
        startTime={startTime}
        now={polled.now}
        phase={currentPhase}
        onPhaseChange={(next) => {
          void handlePhaseChange(next);
        }}
        queueCount={polled.queue.length}
        mustPlayProgress={polled.mustPlayProgress}
      />
      <CeremonyCues mustPlay={mustPlay} played={played} />
      <RequestQueue queue={polled.queue} />
      <BlockedGroup blocked={polled.blocked} />
      <CoupleRules
        mustPlay={mustPlay}
        blocklist={blocklist}
        played={played}
        mustPlayProgress={polled.mustPlayProgress}
      />
      <GuestActivity activity={polled.activity} />
    </div>
  );
}
