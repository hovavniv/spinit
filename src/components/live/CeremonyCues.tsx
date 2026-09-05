'use client';

import { useState } from 'react';

import { CEREMONY_SLOTS } from '@/lib/events/ceremonySlots';
import type { MustPlayRow } from '@/lib/events/detailTypes';
import type { PlayedTrack } from '@/lib/live/liveTypes';
import styles from './CeremonyCues.module.css';

/**
 * The two fixed ceremony cues (design §7.1, §7.3), matched against
 * `mustPlay` rows where `segment === 'ceremony'` by `moment`. A slot can be
 * unfilled -- the DJ hasn't picked a song for it yet.
 *
 * "Play now" is wired for real (Task 17): `onPlayNow` is `playPick`, threaded
 * through the same way every other action in this screen is (a prop, never
 * imported directly, so the caller -- LiveScreen -- is the one place that
 * wires the real server action in). A row with no `spotify_track_id` (a
 * pre-picker slot, per the stale-type note `rank.ts` also carries) gets no
 * button at all -- there is nothing to play.
 */
export function CeremonyCues({
  mustPlay,
  played,
  onPlayNow,
}: {
  mustPlay: MustPlayRow[];
  played: PlayedTrack[];
  onPlayNow: (title: string, artist: string, trackId: string) => Promise<{ ok: boolean }>;
}) {
  const [pendingMoment, setPendingMoment] = useState<string | null>(null);
  const [errorMoment, setErrorMoment] = useState<string | null>(null);

  const playedTrackIds = new Set(
    played.map((p) => p.spotifyTrackId).filter((id): id is string => id !== null),
  );

  async function handlePlayNow(moment: string, title: string, artist: string, trackId: string) {
    setPendingMoment(moment);
    setErrorMoment(null);
    const result = await onPlayNow(title, artist, trackId);
    setPendingMoment(null);
    if (!result.ok) setErrorMoment(moment);
  }

  return (
    <section className={styles.section} aria-label="Ceremony cues">
      <h2 className={styles.heading}>Ceremony</h2>
      <ul className={styles.list}>
        {CEREMONY_SLOTS.map((slot) => {
          const row = mustPlay.find((m) => m.segment === 'ceremony' && m.moment === slot.moment);
          const isPlayed = row?.spotify_track_id != null && playedTrackIds.has(row.spotify_track_id);
          const isPending = pendingMoment === slot.moment;

          return (
            <li key={slot.moment} className={styles.row}>
              <span className={styles.label}>{slot.label}</span>
              {row ? (
                <span className={styles.song}>
                  {row.title}
                  {row.artist ? ` — ${row.artist}` : ''}
                </span>
              ) : (
                <span className={styles.unfilled}>No song set</span>
              )}
              {row && row.spotify_track_id !== null && !isPlayed && (
                <button
                  type="button"
                  className={styles.playNow}
                  aria-label={`Play now: ${row.title}`}
                  disabled={isPending}
                  onClick={() => {
                    const trackId = row.spotify_track_id;
                    if (trackId !== null) void handlePlayNow(slot.moment, row.title, row.artist ?? '', trackId);
                  }}
                >
                  Play now
                </button>
              )}
              {isPlayed && <span className={styles.playedBadge}>Played</span>}
              {errorMoment === slot.moment && (
                <span className={styles.error}>Couldn&apos;t play that — try again.</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
