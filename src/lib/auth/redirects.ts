const ALLOWED_REDIRECTS = new Set(['/dashboard']);

export function safeRedirect(raw: string | null): string {
  return raw !== null && ALLOWED_REDIRECTS.has(raw) ? raw : '/dashboard';
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
