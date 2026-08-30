import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';

/**
 * Claim a partner slot (design §2.6).
 *
 * There is deliberately no UPDATE policy a partner could use instead: a user
 * claiming a slot is not yet a partner, so no event-scoped policy can admit
 * them, and the only policy that would work (`user_id is null`) lets any
 * signed-in user claim every unclaimed slot in the database with one request.
 *
 * The function matches the invitation against the caller's own VERIFIED
 * account email -- the Supabase one, which is unrelated to their Spotify
 * account email and may differ. It writes exactly one column on exactly one
 * row, and `user_id` is writable by no PostgREST role on either verb, so this
 * function is the only path to linkage.
 *
 * It raises 42501 for every failure, so the caller cannot tell "no such event"
 * from "already claimed" from "not your invitation". Returning null rather
 * than throwing keeps that indistinguishable at the callsite too: an error
 * object reaching the UI would leak which of the three happened.
 */
export async function claimPartnerSlot(eventId: string, slot: 1 | 2): Promise<string | null> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('claim_partner_slot', {
    p_event: eventId,
    p_slot: slot,
  });

  if (error) {
    // Code only, never the message: the message names which check failed.
    console.error('claim_partner_slot: refused', { eventId, slot, code: error.code });
    return null;
  }

  return (data as string) ?? null;
}
