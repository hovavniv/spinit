/**
 * Maps Supabase auth errors to generic, user-facing strings and logs the
 * detailed error server-side. See design 7.2: no raw Supabase error text,
 * provider names, internal URLs, stack traces, or submitted user input may
 * reach the client; login failures never distinguish "unknown email" from
 * "wrong password"; and a failing trigger (over-long name, malformed phone)
 * surfaces to the client as the same generic signup-failure message any
 * other signup problem would produce.
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; formErrors: Record<string, string> }
  | { ok: false; message: string };

export type AuthErrorEvent = 'login' | 'signup' | 'oauth' | 'callback';

export interface AuthErrorContext {
  event: AuthErrorEvent;
  /** The verified session's user id, when one is known. Never logged as PII. */
  userId?: string;
  /** Submitted email, kept out of every log line and every client-facing string. */
  email?: string;
  /** Submitted phone, kept out of every log line and every client-facing string. */
  phone?: string;
  /** The Postgres constraint violated, when diagnosable (e.g. a trigger failure). */
  constraint?: string;
}

export type Logger = (message: string, details?: Record<string, unknown>) => void;

const defaultLogger: Logger = (message, details) => {
  console.error(message, details);
};

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';
const GENERIC_SIGNUP_ERROR = 'We could not complete your signup. Please try again.';
const GENERIC_OAUTH_ERROR = 'We could not sign you in. Please try again.';

/**
 * Logs auth-failure detail server-side. Deliberately narrows the payload to
 * `event`, `userId`, and `constraint` only — email and phone are accepted by
 * `AuthErrorContext` for callers' own bookkeeping but are never passed
 * through to the logger (secure-coding rules 10 and 34: no PII in logs).
 */
export function logAuthError(
  context: Pick<AuthErrorContext, 'event' | 'userId' | 'constraint'>,
  logger: Logger = defaultLogger,
): void {
  logger('auth error', {
    event: context.event,
    userId: context.userId,
    constraint: context.constraint,
  });
}

/**
 * Maps any Supabase auth error to a generic `ActionResult` for the client,
 * logging the detail server-side first. The mapping never reads `error`'s
 * message or `context.email`/`context.phone` into the returned string — the
 * output is always one of the fixed generic strings below, which is what
 * makes distinct failures (unknown email vs. wrong password; a trigger
 * failure vs. any other signup problem) collapse to identical client output.
 */
export function mapAuthError(
  error: unknown,
  context: AuthErrorContext,
  logger: Logger = defaultLogger,
): ActionResult {
  logAuthError({ event: context.event, userId: context.userId, constraint: context.constraint }, logger);

  switch (context.event) {
    case 'login':
      return { ok: false, message: GENERIC_LOGIN_ERROR };
    case 'oauth':
    case 'callback':
      return { ok: false, message: GENERIC_OAUTH_ERROR };
    case 'signup':
    default:
      return { ok: false, message: GENERIC_SIGNUP_ERROR };
  }
}
