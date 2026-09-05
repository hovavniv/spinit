import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/validation';
import { formatCardDate } from '@/lib/dashboard/format';
import { startEvent, setPhase, playSuggestion, skipSuggestion, playPick } from '@/lib/live/liveActions';
import { readLiveState } from '@/lib/live/liveDal';
import { rankQueue } from '@/lib/live/rank';
import { minutesLeftInPhase } from '@/lib/live/phaseClock';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { PreFlight } from '@/components/live/PreFlight';
import { LiveScreen } from '@/components/live/LiveScreen';

export const metadata: Metadata = {
  title: 'Live — Spinit',
};

/**
 * /events/[id]/live — pre-flight before the event starts, the live artboard
 * once it has (design §2, §5.2). This is the route
 * `src/components/dashboard/LiveEventBanner.tsx` has linked to since before
 * this branch existed; it has always 404'd until now.
 *
 * DJ only, never a partner and never another DJ's event — both collapse to
 * the same `dj_id !== user.id` check, since the couple is not admitted to
 * the live queue (§3.6). Never a 403 for any of the refusal cases: a 403
 * confirms the id is real and turns this route into an oracle for
 * enumerating event ids, the same rule `/events/[id]` applies.
 *
 * This does its own minimal read directly against `events` rather than
 * going through `detailDal.ts`'s `getEventDetail` — that file is held by
 * `feat/upcoming-events` this week and its `EventDetail` type does not yet
 * carry `status` (their Task 11), which this route's branching depends on.
 * `liveDal.ts` (task 14) is for the full live screen's reads once the event
 * is live; this pre-flight read is smaller and self-contained on purpose.
 */
export default async function LiveEventPage({ params }: PageProps<'/events/[id]/live'>) {
  const { id } = await params;

  if (!isUuid(id)) notFound();

  const user = await requireUser();
  const profile = await getProfile();

  const supabase = await createClient();
  const { data: event } = await supabase
    .from('events')
    .select(
      'id, dj_id, couple_names, venue, event_date, start_time, status, phase, phase_started_at, join_token',
    )
    .eq('id', id)
    .maybeSingle();

  if (!event) notFound();
  if (event.dj_id !== user.id) notFound();
  if (event.status !== 'upcoming' && event.status !== 'live') notFound();

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    company: profile?.business_name || 'Independent DJ',
  };

  let liveScreen: ReactNode = null;
  if (event.status === 'live') {
    // Mirrors the poll route's own wiring (src/app/api/live/[id]/state/route.ts)
    // so this first paint shows the identical initial data a poll would --
    // the client-side 8-second re-polling itself is a later task.
    const state = await readLiveState(event.id);
    const now = new Date();
    const minsLeft = minutesLeftInPhase(state.event.phase, state.event.phaseStartedAt, now);

    const { queue, blocked } = rankQueue({
      suggestions: state.suggestions,
      mustPlay: state.mustPlay,
      blocklist: state.blocklist,
      genresByArtistId: state.genresByArtistId,
      played: state.played,
      phase: state.event.phase,
      minutesLeftInPhase: minsLeft,
    });

    const playedTrackIds = new Set(
      state.played
        .map((p) => p.spotifyTrackId)
        .filter((trackId): trackId is string => trackId !== null),
    );
    const mustPlayPlayed = state.mustPlay.filter(
      (row) => row.spotify_track_id !== null && playedTrackIds.has(row.spotify_track_id),
    ).length;
    const mustPlayProgress = { played: mustPlayPlayed, total: state.mustPlay.length };

    liveScreen = (
      <LiveScreen
        eventId={event.id}
        coupleNames={event.couple_names}
        venue={event.venue}
        eventDate={event.event_date}
        startTime={(event.start_time ?? '00:00:00').slice(0, 5)}
        now={now.toISOString()}
        phase={state.event.phase}
        setPhase={setPhase}
        playSuggestion={playSuggestion}
        skipSuggestion={skipSuggestion}
        playPick={playPick}
        queue={queue}
        blocked={blocked}
        mustPlay={state.mustPlay}
        blocklist={state.blocklist}
        played={state.played}
        mustPlayProgress={mustPlayProgress}
        activity={[]}
      />
    );
  }

  return (
    <AppShell sidebar={<DashboardSidebar dj={dj} current="none" />}>
      {event.status === 'upcoming' ? (
        <PreFlight
          eventId={event.id}
          coupleNames={event.couple_names}
          venue={event.venue}
          eventDate={formatCardDate(event.event_date)}
          startEvent={startEvent}
        />
      ) : (
        liveScreen
      )}
    </AppShell>
  );
}
