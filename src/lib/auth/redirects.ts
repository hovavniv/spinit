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
