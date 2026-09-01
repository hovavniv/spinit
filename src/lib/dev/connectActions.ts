'use server';

import { notFound, redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth/dal';
import { createPartnerRows, claimPartnerSlot } from './connectDal';

/**
 * Server Actions for `/dev/connect` (Spotify connect plan, Task 9).
 *
 * Gated independently from the page: a Server Action is reachable directly
 * (Next posts to it by reference, not by URL, but nothing stops a crafted
 * request from invoking the same reference outside this page's render), so
 * `notFound()` is repeated here rather than trusted from the page alone.
 */
function assertDevOnly(): void {
  if (process.env.NODE_ENV === 'production') notFound();
}

/**
 * Step 1 of Task 9 -- run once, under the DJ's own session: inserts both
 * partner rows for one event. Never inserts `user_id` (unwritable by the
 * grant regardless) and never calls `claim_partner_slot` itself -- an
 * earlier draft combined insert-and-claim in one submission and only ever
 * worked for the first partner, because claiming is bound to the CALLER's
 * own account, and one submission has exactly one caller.
 */
export async function createPartnerSlots(formData: FormData): Promise<void> {
  assertDevOnly();
  await requireUser();

  const eventId = String(formData.get('eventId') ?? '').trim();
  const name1 = String(formData.get('name1') ?? '').trim();
  const email1 = String(formData.get('email1') ?? '').trim();
  const name2 = String(formData.get('name2') ?? '').trim();
  const email2 = String(formData.get('email2') ?? '').trim();

  if (!eventId || !name1 || !email1 || !name2 || !email2) {
    throw new Error('Event id, both display names, and both emails are required.');
  }

  await createPartnerRows(
    eventId,
    { displayName: name1, inviteEmail: email1 },
    { displayName: name2, inviteEmail: email2 },
  );

  redirect(`/dev/connect?eventId=${encodeURIComponent(eventId)}`);
}

/**
 * Step 2 of Task 9 -- run in whichever account is currently signed in.
 * `claimPartnerSlot` (connectDal.ts) calls the `claim_partner_slot` RPC,
 * which matches `slot`'s invitation against the CALLER's own verified
 * account email; a mismatch throws rather than silently doing nothing.
 */
export async function claimSlot(formData: FormData): Promise<void> {
  assertDevOnly();
  await requireUser();

  const eventId = String(formData.get('eventId') ?? '').trim();
  const slot = Number(formData.get('slot'));

  if (!eventId || (slot !== 1 && slot !== 2)) {
    throw new Error('A valid event id and slot (1 or 2) are required.');
  }

  await claimPartnerSlot(eventId, slot);

  redirect(`/dev/connect?eventId=${encodeURIComponent(eventId)}`);
}
