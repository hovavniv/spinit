import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth/dal';
import { listActiveEvents } from '@/lib/dashboard/dal';
import { listVisiblePartnerSlots } from '@/lib/dev/connectDal';
import { createPartnerSlots, claimSlot } from '@/lib/dev/connectActions';
import { connectSpotify } from '@/lib/spotify/actions';

interface DevConnectPageProps {
  searchParams: Promise<{ eventId?: string }>;
}

/**
 * `/dev/connect` -- a development-only tool (Spotify connect plan, Task 9).
 * Lets a developer working alone set up two Spotify-connected partners on
 * one test event without touching the live mailer (Supabase's signup mailer
 * is capped at 2 emails/hour project-wide) and without a second physical
 * device for the common case.
 *
 * Never reachable in production -- both this page and the dev-only actions it
 * calls (`createPartnerSlots`, `claimSlot` in `connectActions.ts`) check
 * `NODE_ENV` independently. `connectSpotify` (in `spotify/actions.ts`) is
 * deliberately NOT gated on `NODE_ENV` -- it is the real, production-reachable
 * connect action; this page just happens to be one of its callers.
 *
 * Two separate steps, not one combined submission (Task 9's own review
 * finding): inserting both `event_partners` rows happens once, under the
 * DJ's session; each partner then claims their own slot in their own
 * session by calling `claim_partner_slot`, which matches the invitation
 * against the CALLER's own verified account email.
 *
 * A row this account cannot yet see (an unclaimed slot invited to a
 * DIFFERENT account, or an unclaimed slot invited to this account but not
 * yet claimed by it -- `event_partners`' SELECT policy admits neither to a
 * non-DJ before the claim) is not treated as an error: this page cannot ask
 * Postgres "which slot invited MY email" without already being the DJ or
 * already being that partner, so slots 1 and 2 always get a "claim this
 * slot" form regardless of what's visible, and `claim_partner_slot` itself
 * -- not this page -- decides whether the caller's email actually matches.
 */
export default async function DevConnectPage({ searchParams }: DevConnectPageProps) {
  if (process.env.NODE_ENV === 'production') notFound();

  const user = await requireUser();
  const { eventId } = await searchParams;

  const events = await listActiveEvents();
  const slots = eventId ? await listVisiblePartnerSlots(eventId) : [];
  const myEmail = (user.email ?? '').toLowerCase();

  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1>Dev: connect Spotify partners</h1>
      <p>Development-only tool -- not reachable in production. Signed in as {user.email}.</p>

      <section>
        <h2>1. Create both partner slots (run once, as the DJ)</h2>
        <form action={createPartnerSlots}>
          <div>
            <label htmlFor="eventId">
              Event
              <select id="eventId" name="eventId" defaultValue={eventId ?? ''} required>
                <option value="" disabled>
                  Choose an event
                </option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.couple_names} -- {event.event_date}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset>
            <legend>Partner 1</legend>
            <label htmlFor="name1">
              Display name
              <input id="name1" type="text" name="name1" required />
            </label>
            <label htmlFor="email1">
              Email (existing confirmed test account)
              <input id="email1" type="email" name="email1" required />
            </label>
          </fieldset>

          <fieldset>
            <legend>Partner 2</legend>
            <label htmlFor="name2">
              Display name
              <input id="name2" type="text" name="name2" required />
            </label>
            <label htmlFor="email2">
              Email (existing confirmed test account)
              <input id="email2" type="email" name="email2" required />
            </label>
          </fieldset>

          <button type="submit">Create both slots</button>
        </form>
      </section>

      <section>
        <h2>2. View / claim slots for an event</h2>
        <form method="get">
          <label htmlFor="viewEventId">
            Event id
            <input id="viewEventId" type="text" name="eventId" defaultValue={eventId ?? ''} required />
          </label>
          <button type="submit">Load</button>
        </form>

        {eventId && (
          <ul>
            {[1, 2].map((slotNumber) => {
              const row = slots.find((s) => s.slot === slotNumber);

              if (!row) {
                // Not visible to this account (either it doesn't exist yet,
                // or it's an invited-but-unclaimed slot RLS won't show
                // before the claim -- see the page-level comment above).
                return (
                  <li key={slotNumber}>
                    Slot {slotNumber}: not visible to this account yet.
                    <form action={claimSlot}>
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="slot" value={slotNumber} />
                      <button type="submit">Claim slot {slotNumber}</button>
                    </form>
                  </li>
                );
              }

              const isMine = row.userId === user.id;
              const matchesMyEmail = row.inviteEmail.toLowerCase() === myEmail;

              return (
                <li key={row.id}>
                  Slot {row.slot}: {row.displayName} ({row.inviteEmail}) --{' '}
                  {row.userId ? (isMine ? 'claimed by you' : 'claimed by another account') : 'unclaimed'}
                  {!row.userId && matchesMyEmail && (
                    <form action={claimSlot}>
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="slot" value={row.slot} />
                      <button type="submit">Claim slot {row.slot}</button>
                    </form>
                  )}
                  {isMine && (
                    <form action={connectSpotify}>
                      <input type="hidden" name="partnerId" value={row.id} />
                      <button type="submit">Connect Spotify</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
