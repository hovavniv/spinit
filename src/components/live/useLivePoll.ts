'use client';

import { useEffect, useState } from 'react';
import type { PlayedTrack, RankedSong } from '@/lib/live/liveTypes';
import type { LiveActivityItem } from './GuestActivity';

export interface LivePollState {
  queue: RankedSong[];
  blocked: RankedSong[];
  activity: LiveActivityItem[];
  mustPlayProgress: { played: number; total: number };
  unresolvedArtistIds: string[];
  /** So CeremonyCues/CoupleRules' "Played" column moves live, not just on
   *  refresh -- both match on spotifyTrackId (design §7.1). */
  played: PlayedTrack[];
  now: string;
}

export interface UseLivePollResult {
  state: LivePollState;
  /** True while a poll has failed and not yet recovered -- the screen shows
   *  a small "reconnecting" marker but keeps rendering `state` unchanged. */
  reconnecting: boolean;
}

/**
 * Steady-state cadence (design §8.3): the DJ's decision cycle is a
 * three-minute song, so sub-second freshness buys nothing.
 */
const POLL_INTERVAL_MS = 8_000;

/** Backoff ceiling on repeated failures, so a real outage does not turn into
 *  a hot loop against the route. */
const MAX_BACKOFF_MS = 64_000;

/**
 * The DJ live screen's poll loop (Task 16a). Owns the interval, fetch,
 * backoff and visibility pause/resume; `LiveScreen` stays a pure render of
 * its props/this hook's state, so it is testable at the DAL boundary without
 * a fetch loop inside it (the split Task 16's own test requires).
 *
 * Deliberately NOT `useEnrichmentPoll`'s failure behaviour: that hook stops
 * polling PERMANENTLY on any non-ok response ("a 503 here means 'stop
 * asking'"), right for a finite enrichment run and wrong here -- a single
 * blip must not freeze the DJ's queue for the rest of the night (§8.4: never
 * blank the queue, keep the last good render). This hook retries with
 * backoff instead and never sets a permanent stopped flag.
 */
export function useLivePoll(eventId: string, initialState: LivePollState): UseLivePollResult {
  const [state, setState] = useState<LivePollState>(initialState);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pausedForHidden = false;
    let failureCount = 0;

    function schedule() {
      if (cancelled) return;
      const delay =
        failureCount === 0
          ? POLL_INTERVAL_MS
          : Math.min(POLL_INTERVAL_MS * 2 ** failureCount, MAX_BACKOFF_MS);
      timer = setTimeout(() => {
        void poll();
      }, delay);
    }

    async function poll() {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        // Stop the chain entirely rather than scheduling into the dark --
        // handleVisibility below restarts it on focus.
        pausedForHidden = true;
        return;
      }

      try {
        const res = await fetch(`/api/live/${eventId}/state`);
        if (cancelled) return;

        if (!res.ok) {
          failureCount += 1;
          setReconnecting(true);
          schedule();
          return;
        }

        const data = (await res.json()) as LivePollState;
        if (cancelled) return;

        failureCount = 0;
        setReconnecting(false);
        // A full replace, never a merge: the poll route's `queue`/`blocked`
        // are already the complete, freshly-ranked truth for this instant --
        // merging with the previous state would resurrect a row the DJ
        // already played or skipped.
        setState(data);
        schedule();
      } catch {
        if (cancelled) return;
        failureCount += 1;
        setReconnecting(true);
        schedule();
      }
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible' && pausedForHidden) {
        pausedForHidden = false;
        void poll();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    void poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [eventId]);

  return { state, reconnecting };
}
