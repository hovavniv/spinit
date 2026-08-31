'use client';

import { useState } from 'react';

import { GENRES, normaliseGenre } from '@/lib/genres/vocabulary';
import styles from './GenrePicker.module.css';

interface GenrePickerProps {
  valueName: string;
}

const MAX_ROWS = 8;

/**
 * Filters the static GENRES vocabulary synchronously as the user types.
 * Unlike TrackPicker, there is no network request, so no loading/error
 * phases, debounce, or AbortController are needed here.
 */
export function GenrePicker({ valueName }: GenrePickerProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const normalised = normaliseGenre(query);
  const matches =
    normalised.length > 0
      ? (GENRES as readonly string[]).filter((genre) => genre.includes(normalised))
      : [];
  const showDropdown = focused && !picked && query.trim().length > 0;
  const visibleMatches = matches.slice(0, MAX_ROWS);

  function handlePick(genre: string) {
    setPicked(genre);
    setQuery('');
  }

  function handleClear() {
    setPicked(null);
    setQuery('');
  }

  return (
    <div className={styles.wrap}>
      <input type="hidden" name={valueName} value={picked ?? ''} readOnly />

      {picked ? (
        <div className={styles.chip}>
          <span>{picked}</span>
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
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search for a genre"
          />

          {showDropdown && (
            <div className={styles.dropdown}>
              <div className={styles.header}>
                <span className={styles.headerText}>Common genres</span>
              </div>

              {visibleMatches.length > 0 ? (
                <ul className={styles.results}>
                  {visibleMatches.map((genre) => (
                    <li
                      key={genre}
                      role="option"
                      aria-selected={false}
                      className={styles.row}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handlePick(genre);
                      }}
                    >
                      {genre}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.hint}>No matching genre.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
