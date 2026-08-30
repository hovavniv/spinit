import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { getEventRecap } from '@/lib/events/dal';
import { mostActiveGuest } from '@/lib/events/recap';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { RecapHeader } from '@/components/events/RecapHeader';
import { StatTile } from '@/components/events/StatTile';
import { FinalPlaylist } from '@/components/events/FinalPlaylist';
import styles from './page.module.css';

const NEEDS_PLAYED_AT =
  'Not available yet — the time each song played is not recorded during an event.';
const NEEDS_VOTING = 'Not available yet — guest song voting is not built.';
const NO_SUGGESTIONS = 'No guest suggestions were recorded for this event.';

/**
 * The title carries the couple's name, so it needs the data and cannot be a
 * static `metadata` export like the Past events page's. getEventRecap is
 * cache()-wrapped, so this shares one round trip with the page body rather
 * than doubling it — and it has to survive the not-found case, since Next
 * calls this before the component runs.
 */
export async function generateMetadata(props: PageProps<'/events/[id]/recap'>): Promise<Metadata> {
  const { id } = await props.params;
  const recap = await getEventRecap(id);

  return {
    title: recap ? `${recap.event.couple_names} — recap — Spinit` : 'Recap — Spinit',
  };
}

/**
 * /events/[id]/recap — design/artboards/Spinit Event Recap.dc.html.
 *
 * `params` is a PROMISE in Next 16 and must be awaited; the synchronous form
 * was deprecated in 15 and removed in 16. `PageProps` is a globally available
 * generated helper — typing it from the route literal gives strict keys and
 * autocomplete, and it needs no import.
 *
 * requireUser() is called here in the page, not in a layout, for the reason
 * src/app/events/past/page.tsx records: a layout check does not re-run on
 * client-side navigation and does not block child segments.
 */
export default async function EventRecapPage(props: PageProps<'/events/[id]/recap'>) {
  const { id } = await props.params;

  const user = await requireUser();
  const profile = await getProfile();
  const recap = await getEventRecap(id);

  if (!recap) notFound();

  const { event, songs } = recap;
  const guest = mostActiveGuest(songs);

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    // business_name is nullable and at least one live row is null, so '' would
    // render an empty chip where the artboard always draws a line.
    company: profile?.business_name || 'Independent DJ',
  };

  return (
    <AppShell
      // 'past', because a recap is reached only from Past events and the
      // sidebar has no recap nav item to highlight.
      sidebar={<DashboardSidebar dj={dj} current="past" />}
      width="narrow"
    >
      <RecapHeader event={event} />

      {/* Three of these five have no data yet and render pending. They keep
          the artboard's grid rather than being dropped -- see design §7.3 for
          why fidelity won that call, and what it cost. */}
      <div className={styles.stats}>
        <StatTile label="Songs played" value={songs.length} />
        <StatTile label="Party length" pendingReason={NEEDS_PLAYED_AT} />
        <StatTile label="Closed" pendingReason={NEEDS_PLAYED_AT} />
        <StatTile
          label="Most active guest"
          value={guest ?? undefined}
          pendingReason={guest === null ? NO_SUGGESTIONS : undefined}
        />
        <StatTile label="Most requested song" pendingReason={NEEDS_VOTING} wide />
      </div>

      <FinalPlaylist songs={songs} />
    </AppShell>
  );
}
