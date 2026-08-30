/* ---------------------------------------------------------------------------
   Who is looking at /events/[id] (design §3, §4).

   Pure and free of `server-only`: the screen is a Client Component and imports
   the Viewer type, which is why this lives beside detailTypes.ts rather than in
   the DAL.

   DJ wins over partner. The two roles are not mutually exclusive in the schema
   -- nothing stops a DJ claiming a slot on their own event -- and the DJ's view
   is the strictly larger one, so ordering the check this way cannot lose
   access.

   This is NOT the access control. RLS decides what the caller can read; a null
   here only tells the route to render notFound() rather than a half-empty page.
   --------------------------------------------------------------------------- */

import type { PartnerRow, Viewer } from './detailTypes';

export function resolveViewer(
  userId: string,
  djId: string,
  partners: PartnerRow[],
): Viewer | null {
  if (userId === djId) return { role: 'dj' };

  // `user_id` is null for an invited-but-unclaimed slot, so the comparison
  // must not match a caller whose id is absent.
  const mine = partners.find((partner) => partner.user_id !== null && partner.user_id === userId);
  return mine ? { role: 'partner', partnerId: mine.id } : null;
}
