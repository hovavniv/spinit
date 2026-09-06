import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { requireUser, getProfile } from '@/lib/auth/dal';
import { signOut } from '@/lib/auth/actions';
import { createClient } from '@/lib/supabase/server';
import { getEventRecap } from '@/lib/events/dal';
import { mostActiveGuest } from '@/lib/events/recap';
import { readMostRequestedPlayed } from '@/lib/live/liveDal';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { RecapHeader } from '@/components/events/RecapHeader';
import { StatTile } from '@/components/events/StatTile';
import { FinalPlaylist } from '@/components/events/FinalPlaylist';
import styles from './page.module.css';

const NEEDS_PLAYED_AT =
  'Not available yet — the time each song played is not recorded during an event.';
/**
 * Guest voting IS built (feat/live-event) -- these two tiles are pending for
 * narrower reasons, and the strings say which. An earlier version claimed
 * voting "is not built", which stopped being true the moment this slice
 * shipped and is exactly the drift a reader has no way to check.
 */
const NEEDS_PARTY_LENGTH =
  'Not available yet — "party length" needs a definition that survives a DJ who plays one song and leaves.';
const VOTES_ARE_DJ_ONLY =
  'Only the DJ can see request counts — song_suggestions and suggestion_votes admit the event owner alone.';
const NO_REQUESTS = 'No guest requests were played at this event.';
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

  // Returns null for a partner: the vote tables admit the DJ alone, so their
  // read is filtered to zero rows rather than erroring. The tile distinguishes
  // "you cannot see this" from "nobody requested anything".
  const mostRequested = await readMostRequestedPlayed(id);

  // A minimal, self-contained read for role only (design §15.4) -- not
  // routed through getEventRecap/EventRecap, whose shape is shared and
  // held by another branch. Anyone reaching this point already participates
  // (getEventRecap's own null-collapse already refused everyone else), so
  // this only decides WHICH participant they are, never whether they may be
  // here at all.
  const supabase = await createClient();
  const { data: eventRow } = await supabase.from('events').select('dj_id').eq('id', id).maybeSingle();
  const isPartner = eventRow !== null && eventRow.dj_id !== user.id;

  const dj = {
    name: profile?.full_name || user.email || 'DJ',
    // business_name is nullable and at least one live row is null, so '' would
    // render an empty chip where the artboard always draws a line. A partner
    // viewer has no business_name at all, so that fallback would otherwise
    // label the couple as a DJ on their own keepsake (design §15.4) -- the
    // same fix /events/[id]/page.tsx already applies for its own sidebar.
    company: isPartner ? 'Getting married' : profile?.business_name || 'Independent DJ',
  };

  return (
    <AppShell
      // 'past', because a recap is reached only from Past events and the
      // sidebar has no recap nav item to highlight. A partner has no Past
      // events of their own, so hideNav for the same reason the event detail
      // page hides it for them.
      sidebar={<DashboardSidebar dj={dj} current="past" hideNav={isPartner} signOutAction={signOut} />}
      width="narrow"
    >
      <RecapHeader event={event} />

      {/* Three of these five have no data yet and render pending. They keep
          the artboard's grid rather than being dropped -- see design §7.3 for
          why fidelity won that call, and what it cost. */}
      <div className={styles.stats}>
        <StatTile label="Songs played" value={songs.length} />
        <StatTile label="Party length" pendingReason={NEEDS_PARTY_LENGTH} />
        <StatTile label="Closed" pendingReason={NEEDS_PLAYED_AT} />
        <StatTile
          label="Most active guest"
          value={guest ?? undefined}
          pendingReason={guest === null ? NO_SUGGESTIONS : undefined}
        />
        {/* Vote counts live on song_suggestions/suggestion_votes, whose select
            policies admit the event's DJ alone -- so a partner reading their
            own recap gets zero rows, not a wrong number. The tile says which
            rather than rendering blank, and widening those policies to the
            couple is a control change nobody has asked for. */}
        <StatTile
          label="Most requested song"
          value={mostRequested ?? undefined}
          pendingReason={
            isPartner ? VOTES_ARE_DJ_ONLY : mostRequested === null ? NO_REQUESTS : undefined
          }
          wide
        />
      </div>

      <FinalPlaylist songs={songs} />
    </AppShell>
  );
}
