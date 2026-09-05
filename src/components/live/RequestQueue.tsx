'use client';

import { useState } from 'react';

import type { RankedSong } from '@/lib/live/liveTypes';
import { renderReasons } from '@/lib/live/reasons';
import styles from './RequestQueue.module.css';

/**
 * The ranked, non-blocked queue (design §7.1, §7.4). The why line under every
 * row is the whole point of the explainable-engine differentiator (CLAUDE.md)
 * -- rendered via `renderReasons`, never reimplemented here.
 *
 * Play/Skip are wired for real (Task 17): `onPlay`/`onSkip` are the caller's
 * job (LiveScreen threads through the real `playSuggestion`/`skipSuggestion`
 * server actions, the page's the one place that imports them for real, the
 * same pattern PreFlight/StartEventSection already use). Neither action's
 * success is rendered optimistically here -- the next poll (at most 8s away)
 * carries the real ranked truth; this component only shows a per-row pending
 * state and surfaces a wrong-state error inline rather than failing silently.
 */
export function RequestQueue({
  queue,
  onPlay,
  onSkip,
}: {
  queue: RankedSong[];
  onPlay: (suggestionId: string) => Promise<{ ok: boolean }>;
  onSkip: (suggestionId: string) => Promise<{ ok: boolean }>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  async function handlePlay(suggestionId: string) {
    setPendingId(suggestionId);
    setErrorId(null);
    const result = await onPlay(suggestionId);
    setPendingId(null);
    if (!result.ok) setErrorId(suggestionId);
  }

  async function handleSkip(suggestionId: string) {
    setPendingId(suggestionId);
    setErrorId(null);
    const result = await onSkip(suggestionId);
    setPendingId(null);
    if (!result.ok) setErrorId(suggestionId);
  }

  return (
    <section className={styles.section} aria-label="Request queue">
      <h2 className={styles.heading}>Request queue ({queue.length})</h2>
      <ul className={styles.list}>
        {queue.map((row) => {
          const title = row.suggestion.resolvedTitle ?? row.suggestion.title;
          const artist = row.suggestion.resolvedArtist ?? row.suggestion.artist;
          const isMustPlay = row.reasons.some((reason) => reason.kind === 'must-play-unplayed');
          const why = renderReasons(row.reasons);
          const isPending = pendingId === row.suggestion.id;

          return (
            <li key={row.suggestion.id} className={styles.row}>
              {/* Decorative -- the row's accessible name is the song, not the rank. */}
              <span className={styles.rank} aria-hidden="true">
                {row.rank}
              </span>
              <div className={styles.info}>
                <p className={styles.title}>
                  {title} <span className={styles.artist}>— {artist}</span>
                  {isMustPlay && <span className={styles.mustPlayPill}>Must-play</span>}
                </p>
                <p className={styles.votes}>
                  {row.suggestion.requesters} {row.suggestion.requesters === 1 ? 'request' : 'requests'}
                </p>
                {why && <p className={styles.why}>{why}</p>}
                {errorId === row.suggestion.id && (
                  <p className={styles.error}>Couldn&apos;t update that — try again.</p>
                )}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.playButton}
                  aria-label={`Play ${title}`}
                  disabled={isPending}
                  onClick={() => {
                    void handlePlay(row.suggestion.id);
                  }}
                >
                  Play
                </button>
                <button
                  type="button"
                  className={styles.skipButton}
                  aria-label={`Skip ${title}`}
                  disabled={isPending}
                  onClick={() => {
                    void handleSkip(row.suggestion.id);
                  }}
                >
                  Skip
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
