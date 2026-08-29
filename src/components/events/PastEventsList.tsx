'use client';

import { useState } from 'react';
import Link from 'next/link';
import { filterPastEvents, groupByMonth, dayTile } from '@/lib/events/pastEvents';
import type { PastEventRow } from '@/lib/events/types';
import styles from './PastEventsList.module.css';

interface PastEventsListProps {
  /** Already ordered by event_date descending — groupByMonth relies on it. */
  events: PastEventRow[];
}

/**
 * The searchable, month-grouped list from
 * design/artboards/Spinit Past Events.dc.html.
 *
 * The only client component on this screen: search is the one interactive
 * thing, and it filters a list already in hand rather than round-tripping per
 * keystroke. That is the artboard's own behaviour, and it is the right answer
 * up to the point the list gets paginated — at which stage client-side search
 * would silently start searching the page rather than the events, so the two
 * changes have to land together (design §10).
 */
export function PastEventsList({ events }: PastEventsListProps) {
  const [query, setQuery] = useState('');

  const visible = filterPastEvents(events, query);
  const groups = groupByMonth(visible);

  const hasNoEventsAtAll = events.length === 0;
  const searchFoundNothing = !hasNoEventsAtAll && visible.length === 0;

  return (
    <>
      <div className={styles.searchWrap}>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          className={styles.searchIcon}
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <line
            x1="16.3"
            y1="16.3"
            x2="21"
            y2="21"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="text"
          className={styles.search}
          placeholder="Search couple or venue…"
          aria-label="Search past events by couple or venue"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {/* The artboard has no live region — it has no screen reader either.
          Without this, someone who types until nothing matches gets silence
          (design §8, deviation 1). */}
      <div aria-live="polite">
        {searchFoundNothing && <div className={styles.empty}>No events match your search.</div>}
        {hasNoEventsAtAll && (
          <div className={styles.empty}>
            No past events yet. Once an event wraps, its recap shows up here.
          </div>
        )}
      </div>

      <div className={styles.list}>
        {groups.map((group) => (
          <div key={group.label} className={styles.group}>
            <div className={styles.monthLabel}>{group.label}</div>

            {group.events.map((event) => {
              const tile = dayTile(event.event_date);
              return (
                <Link key={event.id} href={`/events/${event.id}/recap`} className={styles.row}>
                  <div className={styles.dateTile}>
                    <div className={styles.day}>{tile.day}</div>
                    <div className={styles.weekday}>{tile.weekday}</div>
                  </div>

                  <div className={styles.who}>
                    <div className={styles.couple}>{event.couple_names}</div>
                    <div className={styles.venue}>{event.venue}</div>
                  </div>

                  <span className={styles.songCount}>{event.songs_played} songs played</span>
                  <span className={styles.viewRecap}>View recap →</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
