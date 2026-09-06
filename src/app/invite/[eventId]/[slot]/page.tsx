import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';
import { claimInvite } from '@/lib/events/newEventActions';
import { isUuid } from '@/lib/validation';
import { ClaimForm } from './ClaimForm';
import { InviteSignedOut } from './InviteSignedOut';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Your invitation — Spinit',
};

/**
 * The page a partner opens from the link their DJ sent them (design §4.4).
 *
 * DELIBERATELY GENERIC. It names no couple, no date and no venue: RLS would
 * not show an unclaimed partner the event anyway -- event_partners' select
 * policy admits the row's own user, the event's DJ, or an existing partner,
 * and an unclaimed invitee is none of the three -- and staying generic keeps
 * this route from confirming which event ids exist.
 *
 * PUBLIC TO READ. Not gated with the redirecting auth helper `dal.ts` uses
 * elsewhere: that redirects a signed-out visitor straight to /login, and
 * /login never rendered this page's "Create an account" link -- the only
 * link that carries ?invite=&slot= and puts the register form into partner
 * mode. That made design §4.6 (partner registration) unreachable in
 * production (found on a live walk, 2026-09-03; design §9.3, now closed).
 *
 * Rendering this page publicly leaks nothing: it names no couple, no date and
 * no venue, and renders identically for ANY well-formed uuid, so it confirms
 * nothing about which events exist. The write is still gated -- claimInvite
 * still verifies the caller's session before anything else, and
 * claim_partner_slot matches the caller's own verified account email. Only
 * the READ became public; the WRITE is unchanged.
 */
export default async function InvitePage({ params }: PageProps<'/invite/[eventId]/[slot]'>) {
  const { eventId, slot } = await params;

  if (!isUuid(eventId) || (slot !== '1' && slot !== '2')) notFound();

  // NOT the redirecting auth helper: it redirects, and a signed-out visitor
  // bounced to /login never sees the "Create an account" link below -- the
  // only link that carries ?invite= and puts the register form into partner
  // mode. That made design §4.6 unreachable in production (found on a live
  // walk, 2026-09-03).
  //
  // Rendering this page publicly leaks nothing: it names no couple, no date
  // and no venue, and renders identically for ANY well-formed uuid, so it
  // confirms nothing about which events exist. The write is still gated --
  // claimInvite still verifies the caller's session before anything else,
  // and claim_partner_slot matches the caller's own verified account email.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.title}>You&rsquo;ve been invited</h1>
        <p className={styles.blurb}>
          Your DJ has invited you to help plan a wedding on Spinit. Claim your invitation to
          build your must-play list and connect your streaming profile.
        </p>
        <p className={styles.note}>
          Claim it with the account matching the email address your DJ invited.
        </p>

        {user ? (
          <ClaimForm
            eventId={eventId}
            slot={slot}
            registerHref={`/register?invite=${eventId}&slot=${slot}`}
            claimAction={claimInvite}
          />
        ) : (
          <InviteSignedOut eventId={eventId} slot={slot} />
        )}

        {/*
          Always visible, not only on a failed claim (2026-09-06). A partner
          whose invited email never matches (claim_partner_slot refuses for
          ever), or whose event was deleted/unlinked, has no event_partners
          row and no owned events -- postLoginPath/redirects send them back
          here on every future sign-in, and this standalone page has no app
          nav to escape with. Worded for someone who may be in the wrong
          place, not for the couple this page is meant for.
        */}
        <p className={styles.note}>
          Not expecting this?{' '}
          <Link className={styles.link} href="/dashboard">
            Go to your dashboard.
          </Link>
        </p>
      </div>
    </main>
  );
}
