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
 * Results render in the same floating dropdown panel as the DJ-side
 * `TrackPicker` -- "Searching Spotify" header, album artwork, title over a
 * "<artist> · Song" subtitle -- so choosing a song looks the same on both
 * sides of the product. The one shape difference is deliberate: the DJ
 * picks by clicking the row, the guest presses a Request button, because
 * the guest's row also has to carry the "Requested ✓" state and the
 * three-suggestion cap.
 *
 * `usedCount` MUST come from the DAL's `guest_queue` read (this guest's
 * server-side count), never from `queue.length` or any locally-tracked
 * count of successful requests -- the footer has to be right even after a
 * page reload, and the server is the only place that count actually lives.
 *
 * F3: takes `token`, never `sessionId` -- a session id passed as a prop is
 * serialized into the RSC payload and readable by any script on the page,
 * which is exactly what the cookie's `httpOnly` flag exists to prevent.
 * `suggestAction` now reads the session id off that cookie itself, keyed by
 * `token`.
 */
export function GuestPicker({
  token,
  usedCount,
  suggestAction,
}: {
  token: string;
  usedCount: number;
  suggestAction: (
    token: string,
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
  // TrackPicker's panel closes when the DJ picks a row. This one has no
  // pick -- a guest may request several songs from one search -- so without
  // an explicit dismissal the floating panel would sit over "Your requests"
  // until the field was cleared by hand.
  const [dismissed, setDismissed] = useState(false);
  const fieldRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const field = fieldRef.current;
      if (field && event.target instanceof Node && !field.contains(event.target)) {
        setDismissed(true);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, []);

  async function handleRequest(track: SpotifyTrack) {
    // Marked requested BEFORE the RPC resolves, and the click handler
    // refuses to run again once a track is in this set -- a second click
    // while the first is in flight must not fire a second RPC call.
    if (requestedIds.has(track.id)) return;
    setRequestedIds((prev) => new Set(prev).add(track.id));

    const result = await suggestAction(token, track.id, track.name, track.artistNames[0] ?? '');
    if (result.ok) {
      setToast(
        result.wasExisting
          ? "That song's already up — backed it for you"
          : `${track.name} sent to the DJ`,
      );
      router.refresh();
    } else {
      // M1: a failed suggestion must not leave this track showing
      // "Requested ✓" -- the toast already says it failed, and a guest
      // who cannot retry without a page reload has no way to act on that.
      setRequestedIds((prev) => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
      setToast(result.message);
    }
  }

  const atCap = usedCount >= SUGGESTION_CAP;
  const showDropdown = phase !== 'idle' && !dismissed;
  const visibleResults = results.slice(0, MAX_ROWS);

  return (
    <div className={styles.wrap}>
      <div
        className={styles.field}
        ref={fieldRef}
        onKeyDown={(event) => {
          // Bound on the wrapper, not on the input: the Request buttons are
          // siblings of the input inside .field, not descendants of it, so a
          // keydown while focus sits on one never reaches an input-level
          // handler. Note the limit -- a button a guest has ALREADY requested
          // is disabled, and focus leaves the subtree when that happens, so
          // Escape from there reaches document.body and nothing inside .field
          // can catch it. This helps the enabled-button case only.
          if (event.key === 'Escape') setDismissed(true);
        }}
      >
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
            setDismissed(false);
            if (value.trim().length < MIN_LENGTH) {
              setPhase('idle');
              setResults([]);
              setErrorKind(null);
            }
          }}
          onFocus={() => setDismissed(false)}
          placeholder="Search a song"
        />

        {showDropdown && (
          <div className={styles.dropdown}>
            <div className={styles.header}>
              <span className={styles.headerDot} />
              <span className={styles.headerText}>Searching Spotify</span>
            </div>

            {phase === 'error' && (
              <p className={styles.hint}>
                {errorKind === 'busy'
                  ? "You've searched a lot — give it a minute."
                  : 'Search is unavailable right now.'}
              </p>
            )}

            {phase === 'results' &&
              (visibleResults.length === 0 ? (
                <p className={styles.hint}>
                  Nothing matched — try the artist&rsquo;s name instead.
                </p>
              ) : (
                <ul className={styles.results}>
                  {visibleResults.map((track) => {
                    const requested = requestedIds.has(track.id);
                    const artistName = track.artistNames[0] ?? '';
                    const accessibleName = `${track.name} by ${artistName}`;
                    return (
                      <li key={track.id} className={styles.row}>
                        {/* A track with no artwork keeps the placeholder block so
                            every row is the same height -- same convention as
                            TrackPicker. */}
                        {track.artworkUrl ? (
                          <img src={track.artworkUrl} alt="" className={styles.artwork} />
                        ) : (
                          <div aria-hidden className={styles.artwork} />
                        )}
                        <div className={styles.rowText}>
                          <p className={styles.rowTitle}>{track.name}</p>
                          <p className={styles.rowSubtitle}>{artistName} · Song</p>
                        </div>
                        <button
                          type="button"
                          className={`${styles.requestButton} ${requested ? styles.requestButtonDone : ''}`}
                          aria-pressed={requested}
                          aria-label={
                            requested ? `Requested ${accessibleName}` : `Request ${accessibleName}`
                          }
                          disabled={requested || atCap}
                          onClick={() => handleRequest(track)}
                        >
                          {requested ? 'Requested ✓' : 'Request'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ))}
          </div>
        )}
      </div>

      <p className={styles.footer}>
        {usedCount} of your {SUGGESTION_CAP} song suggestions used
      </p>
      {atCap && (
        <p className={styles.capHint}>
          You&rsquo;ve used all three — you can still back other songs.
        </p>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
