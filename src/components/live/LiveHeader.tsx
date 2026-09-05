'use client';

import { useState } from 'react';

import type { EventPhase } from '@/lib/dashboard/types';
import type { ActionResult } from '@/lib/auth/errors';
import { PhasePicker } from './PhasePicker';
import { EndEventControl } from './EndEventControl';
import { GuestQrModal } from './GuestQrModal';
import styles from './LiveHeader.module.css';

/**
 * Asia/Jerusalem wall-clock parts of an ISO instant. Used only to convert the
 * polled `now` into the same wall-clock representation `eventDate`/`startTime`
 * are already stored in (liveActions.ts writes both as Jerusalem wall clock),
 * so the two can be diffed as naive local Dates without either side reading
 * the browser's own timezone.
 */
function jerusalemPartsFromIso(iso: string): { y: number; m: number; d: number; h: number; min: number } {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get('hour');
  return { y: get('year'), m: get('month'), d: get('day'), h: hour === 24 ? 0 : hour, min: get('minute') };
}

/**
 * Minutes elapsed since the event's Jerusalem wall-clock start. Composes
 * `eventDate`+`startTime` (already Jerusalem wall clock) into one naive local
 * Date, converts `now` (a polled ISO instant) into the SAME wall-clock
 * representation and builds it the same way, then diffs the two naive Dates
 * -- never `start_time` alone (a bare `time` has no date and would wrap past
 * midnight), and never `new Date()` read from inside this component (that
 * would be the browser's clock, not the server's).
 */
function minutesSinceStart(eventDate: string, startTime: string, now: string): number {
  const [y, m, d] = eventDate.split('-').map(Number);
  const [h, min] = startTime.split(':').map(Number);
  const start = new Date(y, m - 1, d, h, min);

  const nowParts = jerusalemPartsFromIso(now);
  const nowLocal = new Date(nowParts.y, nowParts.m - 1, nowParts.d, nowParts.h, nowParts.min);

  return Math.max(0, Math.round((nowLocal.getTime() - start.getTime()) / 60_000));
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m in` : `${m}m in`;
}

/** `startTime` is 'HH:mm', 24h -- rendered as a friendlier 12h clock. */
function formatClock12h(startTime: string): string {
  const [hStr, minStr] = startTime.split(':');
  let h = Number(hStr);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${minStr} ${suffix}`;
}

/**
 * Sticky header for the live screen (design §7.1). `onPhaseChange` is just
 * forwarded to PhasePicker -- LiveScreen (the caller) is the one that
 * actually calls the `setPhase` server action.
 */
export function LiveHeader({
  eventId,
  coupleNames,
  venue,
  eventDate,
  startTime,
  now,
  phase,
  onPhaseChange,
  queueCount,
  mustPlayProgress,
  endEvent,
  joinUrl,
  qrSvg,
}: {
  eventId: string;
  coupleNames: string;
  venue: string;
  eventDate: string;
  startTime: string;
  now: string;
  phase: EventPhase;
  onPhaseChange: (phase: EventPhase) => void;
  queueCount: number;
  mustPlayProgress: { played: number; total: number };
  endEvent: (formData: FormData) => Promise<ActionResult>;
  /** `<siteUrl()>/join/<22-char token>` (design §7.2, §3.7) -- built by the page. */
  joinUrl: string;
  /** Server-rendered QR SVG markup for `joinUrl` (src/lib/live/qr.ts). */
  qrSvg: string;
}) {
  const minutes = minutesSinceStart(eventDate, startTime, now);
  const [qrOpen, setQrOpen] = useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.top}>
        <span className={styles.livePill}>Live</span>
        <div className={styles.identity}>
          <p className={styles.coupleNames}>{coupleNames}</p>
          <p className={styles.meta}>
            {venue} · started{' '}
            <span className={styles.timestamp}>{formatClock12h(startTime)}</span> ·{' '}
            {formatDuration(minutes)}
          </p>
        </div>
        <button type="button" className={styles.qrButton} onClick={() => setQrOpen(true)}>
          Guest QR code
        </button>
        <EndEventControl eventId={eventId} endAction={endEvent} />
      </div>

      {qrOpen && (
        <GuestQrModal
          coupleNames={coupleNames}
          joinUrl={joinUrl}
          qrSvg={qrSvg}
          onClose={() => setQrOpen(false)}
        />
      )}

      <div className={styles.stats}>
        <span className={styles.stat}>{queueCount} in queue</span>
        <span className={styles.stat}>
          {mustPlayProgress.played}/{mustPlayProgress.total} must-plays played
        </span>
      </div>

      <PhasePicker value={phase} onChange={onPhaseChange} />
    </header>
  );
}
