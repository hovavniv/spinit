'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { SpotifyTrack } from '@/lib/spotify/types';
import type { SuggestActionResult } from '@/lib/live/guestActions';
import { Toast } from './Toast';
import styles from './GuestPicker.module.css';

const MIN_LENGTH = 2;
const DEBOUNCE_MS = 300;
const MAX_ROWS = 6;
/** Mirrors `song_suggestions_per_session_limit` -- CLAUDE.md's cap; one guest cannot flood the queue. */
const SUGGESTION_CAP = 3;

type Phase = 'idle' | 'loading' | 'results' | 'error';
type ErrorKind = 'busy' | 'unavailable' | null;

/**
 * The guest's search + suggest pill (design §7.3). Deliberately no
 * free-text fallback -- a typed song has no Spotify artist id, so the
 * couple's do-not-play genre list cannot be checked against it (Niv's
 * ruling, 2026-09-04).
 *
 * `usedCount` MUST come from the DAL's `guest_queue` read (this guest's
 * server-side count), never from `queue.length` or any locally-tracked
 * count of successful requests -- the footer has to be right even after a
 * page reload, and the server is the only place that count actually lives.
 */
export function GuestPicker({
  token,
  sessionId,
  usedCount,
  suggestAction,
}: {
  token: string;
  sessionId: string;
  usedCount: number;
  suggestAction: (
    sessionId: string,
    trackId: string,
    title: string,
    artist: string,
  ) => Promise<SuggestActionResult>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_LENGTH) return;

    const timer = setTimeout(() => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setPhase('loading');
      setErrorKind(null);

      fetch(`/join/${token}/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then(async (response) => {
          if (response.status === 429) {
            setErrorKind('busy');
            setPhase('error');
            return;
          }
          if (!response.ok) {
            setErrorKind('unavailable');
            setPhase('error');
            return;
          }
          let body: { results?: unknown } = {};
          try {
            body = await response.json();
          } catch {
            setErrorKind('unavailable');
            setPhase('error');
            return;
          }
          setResults(Array.isArray(body.results) ? (body.results as SpotifyTrack[]) : []);
          setPhase('results');
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setErrorKind('unavailable');
          setPhase('error');
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controllerRef.current?.abort();
    };
  }, [query, token]);

  async function handleRequest(track: SpotifyTrack) {
    // Marked requested BEFORE the RPC resolves, and the click handler
    // refuses to run again once a track is in this set -- a second click
    // while the first is in flight must not fire a second RPC call.
    if (requestedIds.has(track.id)) return;
    setRequestedIds((prev) => new Set(prev).add(track.id));

    const result = await suggestAction(sessionId, track.id, track.name, track.artistNames[0] ?? '');
    if (result.ok) {
      setToast(
        result.wasExisting
          ? "That song's already up — backed it for you"
          : `${track.name} sent to the DJ`,
      );
      router.refresh();
    } else {
      setToast(result.message);
    }
  }

  const atCap = usedCount >= SUGGESTION_CAP;
  const showDropdown = phase !== 'idle';
  const visibleResults = results.slice(0, MAX_ROWS);

  return (
    <div className={styles.wrap}>
      <input
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        className={styles.input}
        value={query}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          if (value.trim().length < MIN_LENGTH) {
            setPhase('idle');
            setResults([]);
            setErrorKind(null);
          }
        }}
        placeholder="Search a song"
      />

      {showDropdown && phase === 'error' && (
        <p className={styles.hint}>
          {errorKind === 'busy'
            ? "You've searched a lot — give it a minute."
            : 'Search is unavailable right now.'}
        </p>
      )}

      {showDropdown && phase === 'results' && (
        <>
          {visibleResults.length === 0 ? (
            <p className={styles.hint}>Nothing matched — try the artist&rsquo;s name instead.</p>
          ) : (
            <ul className={styles.results}>
              {visibleResults.map((track) => {
                const requested = requestedIds.has(track.id);
                const accessibleName = `${track.name} by ${track.artistNames[0] ?? ''}`;
                return (
                  <li key={track.id} className={styles.row}>
                    <div className={styles.rowText}>
                      <p className={styles.rowTitle}>{track.name}</p>
                      <p className={styles.rowSubtitle}>{track.artistNames[0] ?? ''}</p>
                    </div>
                    <button
                      type="button"
                      className={`${styles.requestButton} ${requested ? styles.requestButtonDone : ''}`}
                      aria-pressed={requested}
                      aria-label={requested ? `Requested ${accessibleName}` : `Request ${accessibleName}`}
                      disabled={requested || atCap}
                      onClick={() => handleRequest(track)}
                    >
                      {requested ? 'Requested ✓' : 'Request'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <p className={styles.footer}>
        {usedCount} of your {SUGGESTION_CAP} song suggestions used
      </p>
      {atCap && (
        <p className={styles.hint}>You&rsquo;ve used all three — you can still back other songs.</p>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
