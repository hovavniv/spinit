import 'server-only';

import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

/**
 * Data-access for `/dev/connect` (Spotify connect plan, Task 9). Dev-only —
 * the page and its actions gate on `NODE_ENV !== 'production'` themselves;
 * this module does not repeat that check, it is never imported outside that
 * page.
 */

export interface DevPartnerSlot {
  id: string;
  slot: number;
  displayName: string;
  inviteEmail: string;
  userId: string | null;
}

interface SlotInput {
  displayName: string;
  inviteEmail: string;
}

/**
 * Inserts both partner rows for an event in one call, as the DJ. Both land
 * with `user_id` NULL -- `event_partners`' INSERT grant is column-scoped and
 * excludes `user_id` (Task 9 §2.6), so this is the only shape an insert can
 * ever take. Claiming (a separate step, `claimPartnerSlot` below, run by
 * each partner in their own session) is what fills `user_id` in.
 */
export async function createPartnerRows(
  eventId: string,
  slot1: SlotInput,
  slot2: SlotInput,
): Promise<void> {
  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('event_partners').insert([
    { event_id: eventId, slot: 1, display_name: slot1.displayName, invite_email: slot1.inviteEmail },
    { event_id: eventId, slot: 2, display_name: slot2.displayName, invite_email: slot2.inviteEmail },
  ]);

  if (error) {
    throw new Error(`event_partners insert failed: ${error.code}`);
  }
}

/**
 * The `event_partners` rows for this event that RLS admits to the CURRENT
 * caller -- not necessarily both. `"dj or participant selects partners"`
 * (Task 9 review finding 7 / the migration's own §5.3 comment) has no clause
 * that admits an invited-but-not-yet-claimed row to anyone except the DJ who
 * owns the event: `user_id = auth.uid()` is false before a claim,
 * `is_event_partner` is false before a claim, so only the `dj_id = auth.uid()`
 * branch can see an unclaimed row, and only for events that caller runs. A
 * partner signed in on their own account, before claiming, legitimately gets
 * ZERO rows back here -- that is RLS working as designed
 * ("NO partner-facing... policy: claiming is claim_partner_slot's job"), not
 * a bug in this query. The page compensates by also offering a slot-number
 * claim form that does not depend on this query returning anything.
 */
export async function listVisiblePartnerSlots(eventId: string): Promise<DevPartnerSlot[]> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('event_partners')
    .select('id, slot, display_name, invite_email, user_id')
    .eq('event_id', eventId)
    .order('slot');

  if (error) {
    console.error('listVisiblePartnerSlots: query failed', { eventId, message: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    slot: row.slot as number,
    displayName: row.display_name as string,
    inviteEmail: row.invite_email as string,
    userId: row.user_id as string | null,
  }));
}

/**
 * Claims one slot for the CURRENT caller by calling the security-definer RPC
 * `claim_partner_slot(p_event uuid, p_slot smallint)` (verified against
 * `supabase/migrations/20260831090000_spotify_foundation.sql`) -- it matches
 * `p_slot`'s invitation against the caller's own verified account email
 * server-side, so this call is safe to offer even when the caller cannot
 * first SELECT the row it targets (see `listVisiblePartnerSlots` above). A
 * caller whose email does not match gets `claim_partner_slot`'s own opaque
 * 42501 failure, surfaced here as a thrown Error.
 */
export async function claimPartnerSlot(eventId: string, slot: number): Promise<void> {
  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.rpc('claim_partner_slot', { p_event: eventId, p_slot: slot });

  if (error) {
    throw new Error(`claim_partner_slot failed: ${error.message}`);
  }
}
