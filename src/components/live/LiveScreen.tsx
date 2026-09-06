'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { EventPhase } from '@/lib/dashboard/types';
import type { ActionResult } from '@/lib/auth/errors';
import type { BlocklistRow, MustPlayRow } from '@/lib/events/detailTypes';
import type { PlayedTrack, RankedSong } from '@/lib/live/liveTypes';
import type { LiveActionResult, PlayResult } from '@/lib/live/liveActions';
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
  playSuggestion: (eventId: string, suggestionId: string) => Promise<PlayResult>;
  skipSuggestion: (eventId: string, suggestionId: string) => Promise<LiveActionResult>;
  playPick: (eventId: string, title: string, artist: string, trackId: string) => Promise<PlayResult>;
  /**
   * `feat/upcoming-events`' own `endEvent` (design §12: this branch calls it,
   * never writes `status = 'completed'` itself). Taken as a prop, the same
   * pattern as every other action here -- a Server Component page is the
   * only place a real server action gets wired in.
   */
  endEvent: (formData: FormData) => Promise<ActionResult>;
  /**
   * `<siteUrl()>/join/<22-char token>` (design §7.2, §3.7) -- threaded down
   * to LiveHeader's QR modal. `null` only for the anomalous "live event with
   * no join_token" case -- see LiveHeader's own prop comment.
   */
  joinUrl: string | null;
  /** Server-rendered QR SVG markup for `joinUrl` (src/lib/live/qr.ts), computed once in the page. `null` iff `joinUrl` is. */
  qrSvg: string | null;
  queue: RankedSong[];
  blocked: RankedSong[];
  mustPlay: MustPlayRow[];
  blocklist: BlocklistRow[];
  played: PlayedTrack[];
  mustPlayProgress: { played: number; total: number };
  /** From `readActivity` (Task 24) -- the last hour of requested/backed events, newest first, capped at 20. */
  activity: LiveActivityItem[];
}

/**
 * The DJ's main working view once an event is live (design §7.1). Assembles,
 * top to bottom: LiveHeader, CeremonyCues, CoupleRules, RequestQueue,
 * BlockedGroup, GuestActivity.
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
  playSuggestion,
  skipSuggestion,
  playPick,
  endEvent,
  joinUrl,
  qrSvg,
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
    played,
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
        eventId={eventId}
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
        endEvent={endEvent}
        joinUrl={joinUrl}
        qrSvg={qrSvg}
      />
      <CeremonyCues
        mustPlay={mustPlay}
        played={polled.played}
        onPlayNow={(title, artist, trackId) => playPick(eventId, title, artist, trackId)}
      />
      <CoupleRules
        mustPlay={mustPlay}
        blocklist={blocklist}
        played={polled.played}
        mustPlayProgress={polled.mustPlayProgress}
        phase={currentPhase}
      />
      <RequestQueue
        queue={polled.queue}
        onPlay={(suggestionId) => playSuggestion(eventId, suggestionId)}
        onSkip={(suggestionId) => skipSuggestion(eventId, suggestionId)}
      />
      <BlockedGroup blocked={polled.blocked} />
      <GuestActivity activity={polled.activity} />
    </div>
  );
}
