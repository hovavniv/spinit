'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './HeroPhoneDemo.module.css';
import { hotRequests, seedSongs, sortByVotes, toggleExpanded } from '@/lib/heroDemo';
import type { Song } from '@/lib/heroDemo';

type Tab = 'guest' | 'dj';

/**
 * The hero phone's interactive interior. Ported from the artboard's
 * `DCLogic` class (design/artboards/Spinit Homepage.dc.html) — same state,
 * same handlers. Sorting and toggling logic live in lib/heroDemo.ts; this
 * component only holds state.
 */
export function HeroPhoneDemo() {
  const [tab, setTab] = useState<Tab>('guest');
  const [songs, setSongs] = useState<Song[]>(seedSongs);
  const [pulsedId, setPulsedId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const pulseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pulseTimeout.current !== null) {
        clearTimeout(pulseTimeout.current);
      }
    };
  }, []);

  function voteFor(id: number) {
    setSongs((current) => current.map((s) => (s.id === id ? { ...s, votes: s.votes + 1 } : s)));
    setPulsedId(id);
    if (pulseTimeout.current !== null) {
      clearTimeout(pulseTimeout.current);
    }
    pulseTimeout.current = setTimeout(() => {
      setPulsedId(null);
      pulseTimeout.current = null;
    }, 260);
  }

  const sortedSongs = sortByVotes(songs);

  return (
    <>
      <div className={styles.tabRow} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'guest'}
          className={`${styles.tab} ${tab === 'guest' ? styles.tabActive : ''}`}
          onClick={() => setTab('guest')}
        >
          Guest view
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'dj'}
          className={`${styles.tab} ${tab === 'dj' ? styles.tabActive : ''}`}
          onClick={() => setTab('dj')}
        >
          DJ view
        </button>
      </div>

      {tab === 'guest' ? (
        <>
          <div className={styles.title}>Table 7 is requesting</div>
          <div className={styles.subtitle}>3 requests per guest · unlimited votes</div>
          <div className={styles.list}>
            {sortedSongs.map((song) => (
              <div
                key={song.id}
                className={`${styles.songRow} ${pulsedId === song.id ? styles.songRowPulsed : ''}`}
              >
                <div>
                  <div className={styles.songTitle}>{song.title}</div>
                  <div className={styles.songArtist}>{song.artist}</div>
                </div>
                <button
                  type="button"
                  aria-label={`Vote for ${song.title}`}
                  className={styles.voteButton}
                  onClick={() => voteFor(song.id)}
                >
                  <span className={styles.voteHeart} aria-hidden="true">
                    ♥
                  </span>
                  <span className={styles.voteCount}>{song.votes}</span>
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className={styles.title}>Hot requests</div>
          <div className={styles.subtitle}>Tap a track to see why it&apos;s ranked there</div>
          <div className={styles.list}>
            {hotRequests.map((req, i) => {
              const isExpanded = expandedId === req.id;
              return (
                <button
                  type="button"
                  key={req.id}
                  className={styles.requestRow}
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedId(toggleExpanded(expandedId, req.id))}
                >
                  <div className={styles.requestRowHeader}>
                    <div className={styles.requestRowLeft}>
                      <div className={`${styles.rankBadge} ${i === 0 ? styles.rankBadgeTop : ''}`}>
                        {i + 1}
                      </div>
                      <div>
                        <div className={styles.requestTitle}>{req.title}</div>
                        <div className={styles.requestCount}>{req.requests} requests</div>
                      </div>
                    </div>
                    <span className={styles.caret} aria-hidden="true">
                      {isExpanded ? '▴' : '▾'}
                    </span>
                  </div>
                  {isExpanded && <div className={styles.why}>{req.why}</div>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
