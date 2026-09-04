'use client';

import { useState } from 'react';
import Link from 'next/link';

import { daysUntil } from '@/lib/dashboard/format';
import type { UpcomingEvent } from '@/lib/dashboard/types';
import { groupByMonth, dayTile } from '@/lib/events/pastEvents';
import {
  filterUpcomingEvents,
  STATUS_FILTERS,
  BADGE_LABELS,
  type StatusFilter,
} from '@/lib/events/upcomingEvents';
import styles from './UpcomingEventsList.module.css';

interface UpcomingEventsListProps {
  /** Already ordered by date ascending — groupByMonth relies on it. */
  events: UpcomingEvent[];
  /** 'YYYY-MM-DDTHH:mm', local wall clock. */
  now: string;
}

const BADGE_CLASS: Record<UpcomingEvent['status'], string> = {
  'streaming-connected': styles.badgeConnected,
  'partly-connected': styles.badgePartly,
  'awaiting-couple': styles.badgeAwaiting,
};

/**
 * The searchable, filterable, month-grouped list from
 * `Spinit Upcoming Events.dc.html`.
 *
 * Named for its shape, not its route, and deliberately NOT `UpcomingEvents`:
 * src/components/dashboard/UpcomingEvents.tsx already exists and is a
 * different component (a two-card summary).
 *
 * The only client component on this screen. Search and the filter pills filter
 * a list already in hand rather than round-tripping per keystroke — the
 * artboard's own behaviour, and the right answer until the list is paginated,
 * at which point client-side filtering would silently start filtering THE PAGE
 * rather than the events (design §10).
 */
export function UpcomingEventsList({ events, now }: UpcomingEventsListProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const visible = filterUpcomingEvents(events, query, filter);
  const groups = groupByMonth(visible, (event) => event.date);

  const hasNoEventsAtAll = events.length === 0;
  const nothingMatched = !hasNoEventsAtAll && visible.length === 0;

  return (
    <>
      <div className={styles.controls}>
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
            aria-label="Search upcoming events by couple or venue"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {/* The artboard's pills carry no state a screen reader can see —
            aria-pressed and the group label are additions, not transcription. */}
        <div className={styles.filters} role="group" aria-label="Filter by streaming connection">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              className={filter === option.key ? styles.pillActive : styles.pill}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Without the live region, someone who filters until nothing matches
          gets silence. The artboard has no screen reader. */}
      <div aria-live="polite">
        {hasNoEventsAtAll && (
          <div className={styles.empty}>
            No upcoming events yet. Create one to get it on the board.
          </div>
        )}
        {nothingMatched && (
          <div className={styles.empty}>No events match your search or filters.</div>
        )}
      </div>

      <div className={styles.list}>
        {groups.map((group) => (
          <div key={group.label} className={styles.group}>
            <div className={styles.monthLabel}>{group.label.toUpperCase()}</div>

            {group.events.map((event) => {
              const tile = dayTile(event.date);
              const chip = daysUntil(event.date, now);
              return (
                <Link key={event.id} href={`/events/${event.id}`} className={styles.row}>
                  <div className={styles.dateTile}>
                    {/* Unpadded, deliberately: dayTile() returns a plain
                        number, the artboard renders it unpadded, and
                        PastEventsList already renders {tile.day} the same way.
                        Do not add .padStart('0') here -- it would silently
                        disagree with the sibling screen. */}
                    <div className={styles.day}>{tile.day}</div>
                    <div className={styles.weekday}>{tile.weekday}</div>
                  </div>

                  <div className={styles.who}>
                    <div className={styles.couple}>{event.coupleNames}</div>
                    <div className={styles.venue}>{event.venue}</div>
                  </div>

                  <span className={BADGE_CLASS[event.status]}>{BADGE_LABELS[event.status]}</span>

                  {chip !== null && (
                    <span className={styles.daysUntil} data-testid="days-until-chip">
                      {chip}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
