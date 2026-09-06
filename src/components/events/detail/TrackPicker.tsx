'use client';

import { useEffect, useRef, useState } from 'react';

import type { SpotifyArtist, SpotifySearchType, SpotifyTrack } from '@/lib/spotify/types';
import styles from './TrackPicker.module.css';

type PickerFields =
  | { kind: 'titleArtist'; titleName: string; artistName: string }
  | { kind: 'singleValue'; valueName: string };

interface TrackPickerProps {
  /** Prefix for every hidden input this picker writes. */
  namePrefix?: string;
  /** 'track' (default) or 'artist' — which Spotify search endpoint and result shape to use. */
  searchType?: SpotifySearchType;
  /** How the chosen result becomes form fields. */
  fields: PickerFields;
  onPick?: (result: SpotifyTrack | SpotifyArtist) => void;
  /** When TrackPicker's own markup is NOT inside a <form> (e.g. CeremonySongs,
   *  whose inputs reach an outside form via the `form` attribute — see
   *  formId.ts), pass that form's id here. Applied to every <input> this
   *  component renders, hidden AND the visible combobox alike. */
  formId?: string;
  /** Seed the picker as already-picked, e.g. an existing DB row being edited.
   *  Renders the chip immediately, no search needed. Minimal shape because a
   *  saved row has no album art/duration/etc — only the fields the chip and
   *  hidden inputs actually use.
   *
   *  `artistId` MUST be threaded through when the caller has one: without it,
   *  `buildInitialPick` produces an empty `artistIds` array, so
   *  `spotifyArtistId`'s hidden input renders '' and a Save that never
   *  touches this slot writes that '' as null over a real id the row already
   *  had — the ceremony update branch's own bug, one layer up (found by
   *  fresh-context review). */
  initialPick?: InitialPick | null;
}

/** `artworkUrl` comes from EventDetail.artworkById -- a saved row stores only
 *  the Spotify id, never the picture, so the chip has no image until the
 *  server resolves one. Optional: without it the chip simply has no thumbnail,
 *  exactly as a pre-picker row does. */
interface InitialPick {
  id: string;
  name: string;
  artistName?: string;
  artistId?: string;
  artworkUrl?: string | null;
}

function buildInitialPick(
  initialPick: InitialPick | null | undefined,
  searchType: SpotifySearchType,
): SearchResult | null {
  if (!initialPick) return null;
  if (searchType === 'artist') {
    const artist: SpotifyArtist = {
      id: initialPick.id,
      name: initialPick.name,
      artworkUrl: initialPick.artworkUrl ?? null,
    };
    return artist;
  }
  const track: SpotifyTrack = {
    id: initialPick.id,
    name: initialPick.name,
    artistNames: initialPick.artistName ? [initialPick.artistName] : [],
    artistIds: initialPick.artistId ? [initialPick.artistId] : [],
    albumName: '',
    artworkUrl: initialPick.artworkUrl ?? null,
    durationMs: 0,
    explicit: false,
  };
  return track;
}

type Phase = 'idle' | 'loading' | 'results' | 'error';
type ErrorKind = 'busy' | 'unavailable' | null;
type SearchResult = SpotifyTrack | SpotifyArtist;

const MAX_ROWS = 6;
const MIN_LENGTH = 2;
const DEBOUNCE_MS = 300;

/**
 * The dropdown's "where these results come from" header. Kept as its own
 * small render so a sibling component (GenrePicker) can swap it for a
 * different header while reusing this module's CSS — see design §4.3/4.4.
 */
function SearchingSpotifyHeader() {
  return (
    <div className={styles.header}>
      <span className={styles.headerDot} />
      <span className={styles.headerText}>Searching Spotify</span>
    </div>
  );
}

function isArtistResult(result: SearchResult, searchType: SpotifySearchType): result is SpotifyArtist {
  return searchType === 'artist';
}

export function TrackPicker({
  namePrefix,
  searchType = 'track',
  fields,
  onPick,
  formId,
  initialPick,
}: TrackPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [picked, setPicked] = useState<SearchResult | null>(() => buildInitialPick(initialPick, searchType));
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (picked) return;
    const trimmed = query.trim();
    // The short-query reset lives in handleChange (an event handler), not
    // here: calling setState synchronously at the top of an effect body
    // triggers react-hooks/set-state-in-effect, since that reset is derived
    // purely from the just-typed value, not from an external system.
    if (trimmed.length < MIN_LENGTH) return;

    const timer = setTimeout(() => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setPhase('loading');
      setErrorKind(null);

      fetch(`/api/spotify/search?q=${encodeURIComponent(trimmed)}&type=${searchType}`, {
        signal: controller.signal,
      })
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
          setResults(Array.isArray(body.results) ? (body.results as SearchResult[]) : []);
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
  }, [query, searchType, picked]);

  function handlePick(result: SearchResult) {
    setPicked(result);
    setQuery('');
    setPhase('idle');
    setResults([]);
    onPick?.(result);
  }

  function handleClear() {
    setPicked(null);
    setQuery('');
    setPhase('idle');
    setResults([]);
    setErrorKind(null);
  }

  const prefix = namePrefix ?? '';
  const pickedTrack = picked && !isArtistResult(picked, searchType) ? (picked as SpotifyTrack) : null;
  const pickedArtist = picked && isArtistResult(picked, searchType) ? (picked as SpotifyArtist) : null;
  const firstArtistName = pickedTrack?.artistNames[0] ?? '';
  const firstArtistId = pickedTrack?.artistIds[0] ?? '';

  let chipLabel = '';
  let hiddenInputs: React.ReactNode;

  if (fields.kind === 'singleValue') {
    const value = pickedArtist ? pickedArtist.name : pickedTrack ? `${pickedTrack.name} — ${firstArtistName}` : '';
    const spotifyId = pickedArtist?.id ?? pickedTrack?.id ?? '';
    chipLabel = value;
    hiddenInputs = (
      <>
        <input type="hidden" name={`${prefix}${fields.valueName}`} value={value} readOnly form={formId} />
        <input type="hidden" name={`${prefix}spotifyId`} value={spotifyId} readOnly form={formId} />
      </>
    );
  } else {
    const title = pickedArtist ? pickedArtist.name : pickedTrack ? pickedTrack.name : '';
    const artist = pickedArtist ? '' : firstArtistName;
    chipLabel = pickedTrack ? `${title} — ${artist}` : title;
    hiddenInputs = (
      <>
        <input type="hidden" name={`${prefix}${fields.titleName}`} value={title} readOnly form={formId} />
        <input type="hidden" name={`${prefix}${fields.artistName}`} value={artist} readOnly form={formId} />
        <input
          type="hidden"
          name={`${prefix}spotifyTrackId`}
          value={pickedTrack?.id ?? ''}
          readOnly
          form={formId}
        />
        <input
          type="hidden"
          name={`${prefix}spotifyArtistId`}
          value={pickedArtist?.id ?? firstArtistId}
          readOnly
          form={formId}
        />
      </>
    );
  }

  const showDropdown = !picked && phase !== 'idle';
  const visibleResults = results.slice(0, MAX_ROWS);

  return (
    <div className={styles.wrap}>
      {hiddenInputs}

      {picked ? (
        <div className={styles.chip}>
          {/* Same square-song / round-artist convention as the dropdown rows
              below. The placeholder div keeps the chip's height and text
              baseline identical whether or not an image resolved. */}
          {picked.artworkUrl ? (
            <img
              src={picked.artworkUrl}
              alt=""
              className={`${styles.chipArtwork} ${pickedArtist ? styles.artworkArtist : styles.artworkSong}`}
            />
          ) : (
            <div
              aria-hidden
              className={`${styles.chipArtwork} ${pickedArtist ? styles.artworkArtist : styles.artworkSong}`}
            />
          )}
          <span>{chipLabel}</span>
          <button type="button" className={styles.chipClear} onClick={handleClear} aria-label="Clear selection">
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            role="combobox"
            aria-expanded={showDropdown}
            aria-autocomplete="list"
            className={styles.input}
            value={query}
            form={formId}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (value.trim().length < MIN_LENGTH) {
                setPhase('idle');
                setResults([]);
                setErrorKind(null);
              }
            }}
            placeholder={searchType === 'artist' ? 'Search for an artist' : 'Search for a song'}
          />

          {showDropdown && (
            <div className={styles.dropdown}>
              <SearchingSpotifyHeader />

              {phase === 'error' && (
                <p className={styles.hint}>
                  {errorKind === 'busy'
                    ? 'Spotify search is busy right now — try again in a moment.'
                    : 'Search is unavailable right now.'}
                </p>
              )}

              {phase === 'results' && (
                <>
                  <ul className={styles.results}>
                    {visibleResults.map((result) => {
                      const isArtist = isArtistResult(result, searchType);
                      const track = result as SpotifyTrack;
                      const artist = result as SpotifyArtist;
                      const subtitle = isArtist ? 'Artist' : `${track.artistNames[0] ?? ''} · Song`;
                      return (
                        <li
                          key={result.id}
                          role="option"
                          aria-selected={false}
                          className={styles.row}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            handlePick(result);
                          }}
                        >
                          {result.artworkUrl ? (
                            <img
                              src={result.artworkUrl}
                              alt=""
                              className={`${styles.artwork} ${isArtist ? styles.artworkArtist : styles.artworkSong}`}
                            />
                          ) : (
                            <div
                              aria-hidden
                              className={`${styles.artwork} ${isArtist ? styles.artworkArtist : styles.artworkSong}`}
                            />
                          )}
                          <div className={styles.rowText}>
                            <div className={styles.rowName}>{isArtist ? artist.name : track.name}</div>
                            <div className={styles.rowSubtitle}>{subtitle}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {results.length < 3 && <p className={styles.hint}>Try adding the artist name.</p>}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
