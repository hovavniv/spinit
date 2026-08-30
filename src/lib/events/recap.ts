/* ---------------------------------------------------------------------------
   Pure derivations for the Event recap screen
   (docs/specs/2026-08-30-event-recap-design.md §6).

   Functions of their arguments only — no React, no Supabase, no clock. That
   is what makes them cheap to test, and it is the same shape pastEvents.ts
   has.
   --------------------------------------------------------------------------- */

import type { PlayedSong } from './types';

/**
 * The one place that decides whether a song has a suggester.
 *
 * `suggested_by` is nullable AND its check constraint permits '' (see
 * 20260829171500_events.sql). Two call sites answering that question
 * differently is how one of them ends up rendering 'requested by ' with a
 * dangling space, or crowning a guest named nothing as the most active one.
 * Returns the trimmed name, or null when absent.
 */
function suggester(song: PlayedSong): string | null {
  const name = song.suggested_by?.trim() ?? '';
  return name === '' ? null : name;
}

/** The right-hand label on a playlist row. */
export function songTag(song: PlayedSong): string {
  const name = suggester(song);
  return name === null ? 'DJ pick' : `requested by ${name}`;
}

/**
 * The guest who suggested the most songs, or null when nobody did.
 *
 * Ties break by earliest appearance in playlist order. A Map iterates in
 * insertion order, so building it by walking the playlist already gives that
 * — but the strict `>` below is what makes it a guarantee rather than an
 * accident, and it is the difference between a deterministic test and a flaky
 * one. Do not "simplify" it to `>=`.
 */
export function mostActiveGuest(songs: PlayedSong[]): string | null {
  const counts = new Map<string, number>();

  for (const song of songs) {
    const name = suggester(song);
    if (name === null) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  let winner: string | null = null;
  let best = 0;

  for (const [name, count] of counts) {
    if (count > best) {
      winner = name;
      best = count;
    }
  }

  return winner;
}
