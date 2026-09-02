'use client';

import { useEffect, useState } from 'react';

export interface EnrichmentProgress {
  settled: number;
  total: number;
}

export interface UseEnrichmentPollResult {
  progress: EnrichmentProgress | null;
  stopped: boolean;
}

/** Shape of `POST /api/spotify/enrich-next`'s 200 body (route.ts's `queueStatus`),
 *  plus its optional backoff hint. `remaining` is what drives whether to poll
 *  again; `settled`/`total` are what the UI renders. */
interface EnrichNextResponse {
  remaining: number;
  settled?: number;
  total?: number;
  retryAfter?: number;
}

/** Steady-state poll cadence while the route has no backoff opinion of its
 *  own. Picked to be responsive against a slow, rate-limited backend (the
 *  ladder paces MusicBrainz/Last.fm at 2s per call) without hammering the
 *  route once a second. */
const POLL_INTERVAL_MS = 3_000;

/**
 * Polls `POST /api/spotify/enrich-next` for ONE partner's own queue while
 * `remaining > 0`, and stops -- permanently, not just for this tick -- on any
 * non-ok response or a fetch throw. This is a client-side circuit breaker,
 * distinct from the route's own retry/backoff logic (migration 2d's
 * exponential per-artist backoff): a 503 here means "stop asking", not
 * "try again in a moment".
 *
 * `partnerId === null` never fetches at all -- used when a partner has no
 * connected Spotify account yet, so no `enrichment_queue` row can exist for
 * them (see the couple-combination wrapper, TasteProfileClient.tsx, which
 * calls this hook once per partner and decides that null).
 */
export function useEnrichmentPoll(partnerId: string | null): UseEnrichmentPollResult {
  const [progress, setProgress] = useState<EnrichmentProgress | null>(null);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (partnerId === null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await fetch('/api/spotify/enrich-next', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partnerId }),
        });
        if (cancelled) return;

        if (!res.ok) {
          setStopped(true);
          return;
        }

        const data = (await res.json()) as EnrichNextResponse;
        if (cancelled) return;

        if (typeof data.settled === 'number' && typeof data.total === 'number') {
          setProgress({ settled: data.settled, total: data.total });
        }

        if (data.remaining > 0) {
          // `retryAfter` (route.ts's RETRY_AFTER_SECONDS, seconds) is the
          // route telling us the claim came back empty because everything
          // remaining is inside its own 2d-migration backoff window -- a
          // bare interval re-poll here would turn that cooling-off window
          // into a hot loop against MusicBrainz/Last.fm.
          const delayMs = data.retryAfter !== undefined
            ? data.retryAfter * 1_000
            : POLL_INTERVAL_MS;
          timer = setTimeout(() => { void poll(); }, delayMs);
        }
      } catch {
        if (!cancelled) setStopped(true);
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [partnerId]);

  return { progress, stopped };
}
