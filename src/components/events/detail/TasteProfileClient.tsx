'use client';

import { useEnrichmentPoll } from '@/components/events/useEnrichmentPoll';
import type { PartnerRow } from '@/lib/events/detailTypes';
import { TasteProfile } from './TasteProfile';

interface TasteProfileClientProps {
  partner1: PartnerRow;
  partner2: PartnerRow;
  genresByArtistId: Record<string, Record<string, number>>;
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
 */
export function TasteProfileClient({ partner1, partner2, genresByArtistId }: TasteProfileClientProps) {
  const poll1 = useEnrichmentPoll(pollTargetOf(partner1));
  const poll2 = useEnrichmentPoll(pollTargetOf(partner2));

  const progress = {
    settled: (poll1.progress?.settled ?? 0) + (poll2.progress?.settled ?? 0),
    total: (poll1.progress?.total ?? 0) + (poll2.progress?.total ?? 0),
  };

  return (
    <TasteProfile
      partner1={{ name: partner1.display_name, profile: partner1.profile }}
      partner2={{ name: partner2.display_name, profile: partner2.profile }}
      genresByArtistId={genresByArtistId}
      progress={progress}
    />
  );
}
