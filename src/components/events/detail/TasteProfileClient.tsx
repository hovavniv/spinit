'use client';

import { useEnrichmentPoll } from '@/components/events/useEnrichmentPoll';
import type { PartnerRow } from '@/lib/events/detailTypes';
import { TasteProfile } from './TasteProfile';

interface TasteProfileClientProps {
  partner1: PartnerRow;
  partner2: PartnerRow;
  genresByArtistId: Record<string, Record<string, number>>;
  /** Server-computed counts over BOTH partners' `enrichment_queue` rows
   *  (`detailDal.ts`, fix-spec Blocker 1) -- the value the DJ actually sees,
   *  since they cannot poll. A successful poll (partner viewers only)
   *  overrides it below; see this component's own header comment. */
  enrichmentProgress: { settled: number; total: number };
}

/**
 * Which id (if any) `useEnrichmentPoll` should poll for this partner. A
 * partner with no connected Spotify account yet cannot have an
 * `enrichment_queue` row (task 7b seeds the queue on sync, which only runs
 * once connected) -- polling them would just churn 403/empty responses, so
 * pass `null` and let the hook's own null-partnerId handling skip the
 * fetch entirely.
 */
function pollTargetOf(partner: PartnerRow): string | null {
  return partner.connection?.status === 'connected' && partner.profile !== null
    ? partner.id
    : null;
}

/**
 * DESIGN RESOLUTION NOT SPECIFIED IN THE PLAN (plan task 10's gap, resolved
 * at implementation time): each partner enriches independently against
 * their OWN `taste_profiles`/`enrichment_queue` rows -- task 7's route is
 * scoped to one partner per call, and `useEnrichmentPoll` itself only knows
 * about one partner. `TasteProfile` needs ONE combined `progress` covering
 * BOTH partners, and nothing upstream says how to combine two partners'
 * counts into one number.
 *
 * Chosen here: call the hook once per partner and SUM `settled` and `total`
 * across both. A partner not yet polling (see `pollTargetOf`) contributes
 * `0`/`0`, which is also what makes `TasteProfile`'s `progress.total === 0`
 * branch ("nobody has connected yet") correct for that partner -- there is
 * no `enrichment_queue` total to report until they have.
 *
 * This file is the reason `TasteProfile.tsx` itself needed NO changes for
 * this task: it already takes `progress` as a prop (task 9), and this
 * wrapper is what supplies a REAL value instead of `EventDetailScreen`'s
 * former `{ settled: 1, total: 1 }` placeholder.
 *
 * FIX-SPEC BLOCKER 1: polling alone is not enough. `useEnrichmentPoll` hits a
 * partner-only route -- a DJ gets 403 on both polls, `poll1.progress` and
 * `poll2.progress` both stay `null` forever, and the sum above used to
 * collapse to `{0, 0}`, which `TasteProfile` reads as "nobody has connected
 * yet". The DJ is the primary reader of this whole report and never saw a
 * genre panel. `enrichmentProgress` (from `detailDal.ts`, RLS admits the DJ)
 * is now the SEED value; a poll only overrides it once at least one of the
 * two hooks has actually resolved something -- which never happens for a DJ,
 * so a DJ's progress is the server value for the page's whole lifetime, and a
 * partner's progress upgrades from the server's last-known count to a live
 * one the moment their own poll answers.
 */
export function TasteProfileClient({
  partner1,
  partner2,
  genresByArtistId,
  enrichmentProgress,
}: TasteProfileClientProps) {
  const poll1 = useEnrichmentPoll(pollTargetOf(partner1));
  const poll2 = useEnrichmentPoll(pollTargetOf(partner2));

  const progress =
    poll1.progress || poll2.progress
      ? {
          settled: (poll1.progress?.settled ?? 0) + (poll2.progress?.settled ?? 0),
          total: (poll1.progress?.total ?? 0) + (poll2.progress?.total ?? 0),
        }
      : enrichmentProgress;

  return (
    <TasteProfile
      partner1={{ name: partner1.display_name, profile: partner1.profile, joined: partner1.user_id !== null }}
      partner2={{ name: partner2.display_name, profile: partner2.profile, joined: partner2.user_id !== null }}
      genresByArtistId={genresByArtistId}
      progress={progress}
    />
  );
}
