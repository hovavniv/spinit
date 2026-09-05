/**
 * Maps the guest-facing RPCs' errors to user copy (design §8.4).
 *
 * Every one of the six `security definer` functions fails with a bare
 * `raise exception '<code>'` in plpgsql, which PostgREST/supabase-js
 * surfaces with SQLSTATE `P0001` for EVERY one of them -- so `error.code`
 * cannot discriminate between them. The code is only ever in
 * `error.message`. This file switches/indexes on `error.message`, never on
 * `error.code`, deliberately -- an earlier draft got this backwards.
 */

export type GuestErrorCode =
  | 'no_such_event'
  | 'event_not_live'
  | 'bad_display_name'
  | 'no_such_session'
  | 'suggestion_limit'
  | 'bad_track'
  | 'bad_input'
  | 'wrong_event';

/**
 * `Record<GuestErrorCode, string>` rather than a `switch`: adding a code to
 * the union without adding a message here fails `tsc`, the same exhaustive-
 * mapping pattern `src/lib/auth/errors.ts` uses.
 */
const GUEST_ERROR_MESSAGES: Record<GuestErrorCode, string> = {
  no_such_event: "That link isn't valid.",
  event_not_live: "This event hasn't started yet, or it's over.",
  bad_display_name: 'Enter a name so the DJ knows who asked.',
  no_such_session: "Your session's expired — rejoin to keep requesting songs.",
  suggestion_limit: "You've used all three — you can still back other songs.",
  bad_track: "Couldn't add that one.",
  bad_input: "Couldn't add that one.",
  wrong_event: "Your session's expired — rejoin to keep requesting songs.",
};

const GENERIC_MESSAGE = 'Something went wrong — try again in a moment.';

function isGuestErrorCode(value: string): value is GuestErrorCode {
  return Object.prototype.hasOwnProperty.call(GUEST_ERROR_MESSAGES, value);
}

/**
 * Pulls `error.message` off a Postgrest/Supabase error shape (or anything
 * error-shaped) and looks it up in the table above. Falls back to a generic
 * message for anything unrecognized -- a network failure, an unexpected
 * shape, or a message this app has no copy for.
 */
export function mapGuestError(error: unknown): { code: GuestErrorCode | 'unknown'; message: string } {
  const message =
    error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : '';

  if (isGuestErrorCode(message)) {
    return { code: message, message: GUEST_ERROR_MESSAGES[message] };
  }
  return { code: 'unknown', message: GENERIC_MESSAGE };
}
