import { isUuid } from '@/lib/validation';

const ALLOWED_REDIRECTS = new Set(['/dashboard']);

/**
 * True for exactly `/invite/{uuid}/{1|2}` and nothing else.
 *
 * Split-and-check rather than one regex, and `isUuid` (z.uuid()) rather than a
 * hand-rolled character class, so this and /invite/[eventId]/[slot] agree on
 * what an event id is. A `[0-9a-fA-F-]{36}` class would also admit 36 hyphens.
 *
 * The four-part split rejects a query string, a fragment, a traversal, a
 * protocol-relative `//host`, an absolute URL and any surrounding whitespace,
 * because none of those produce exactly ['', 'invite', id, slot].
 */
function isInvitePath(raw: string): boolean {
  const parts = raw.split('/');
  return (
    parts.length === 4 &&
    parts[0] === '' &&
    parts[1] === 'invite' &&
    isUuid(parts[2]) &&
    (parts[3] === '1' || parts[3] === '2')
  );
}

/**
 * The open-redirect guard on /auth/callback's `next`, and on the invite cookie
 * (docs/specs/2026-09-02-new-event-design.md §4.7).
 *
 * WIDENED DELIBERATELY AND NARROWLY, with the repo owner's explicit approval
 * (2026-09-02), to carry a partner from email confirmation back to their
 * invitation. The exact-match /dashboard entry is untouched and everything
 * that does not match still falls through to it.
 *
 * The output is fed to `new URL(result, siteUrl())`. Verified 2026-09-03 by
 * running the hostile inputs through that expression, not by reasoning about
 * the predicate: every one of them resolves to this site's own origin.
 */
export function safeRedirect(raw: string | null): string {
  if (raw === null) return '/dashboard';
  if (ALLOWED_REDIRECTS.has(raw)) return raw;
  if (isInvitePath(raw)) return raw;
  return '/dashboard';
}

/**
 * The pending invitation a partner's own account remembers, or null.
 *
 * WHY THIS EXISTS ALONGSIDE THE COOKIE (2026-09-06). `spinit_invite` expires
 * after 30 minutes, and opening a confirmation email later than that is
 * ordinary. `postLoginPath` cannot cover for the gap: it infers "is a partner"
 * from an `event_partners` row carrying their user_id, and only
 * `claim_partner_slot` writes that row -- AFTER confirmation, on a button
 * press. A partner is therefore never detectable as one at the moment they
 * confirm, so every partner whose cookie had expired landed on the DJ
 * dashboard. `signUpWithPassword` now also stores the path on the user's own
 * metadata, which travels with the account rather than the browser, and this
 * reads it back. (Confirming on a different DEVICE is a separate matter: it
 * fails earlier still, at the PKCE exchange, and is rescued only at the next
 * password login.)
 *
 * `user_metadata` is user-writable via `auth.updateUser`, so the value is
 * attacker-controlled and goes through `safeRedirect` like every other
 * untrusted path in this file. Forging it wins a redirect to a page that is
 * already public to read; the claim behind it still matches the caller's own
 * confirmed email inside `claim_partner_slot`.
 *
 * Returns null rather than '/dashboard' for "nothing usable", so a caller
 * cannot accidentally treat the fallback as a real destination.
 */
export function invitePathFromMetadata(metadata: unknown): string | null {
  const raw =
    typeof metadata === 'object' && metadata !== null
      ? (metadata as Record<string, unknown>).invite_path
      : undefined;
  if (typeof raw !== 'string') return null;
  const path = safeRedirect(raw);
  return path === '/dashboard' ? null : path;
}

/**
 * Where a user lands right after signing in (plan task 14 step 4). Pure and
 * free of I/O on purpose — the caller resolves `ownsEvents`/`isPartner` from
 * the database and this function only decides between the two destinations,
 * so the decision itself is one place, unit-testable without a client.
 *
 * DJ wins over partner: nothing in the schema stops a DJ claiming a slot on
 * their own event, and the DJ view is the strictly larger one — the same
 * precedence `resolveViewer` already applies to a single event (design §4).
 */
export function postLoginPath({
  ownsEvents,
  isPartner,
}: {
  ownsEvents: boolean;
  isPartner: boolean;
}): string {
  return !ownsEvents && isPartner ? '/my-event' : '/dashboard';
}
