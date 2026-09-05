import { describe, expect, it } from 'vitest';

import { mapGuestError } from './guestErrors';

/**
 * `mapGuestError` switches on `error.message`, never `error.code` -- every
 * one of the six guest RPCs raises `raise exception '<code>'` in plpgsql,
 * which supabase-js surfaces as SQLSTATE P0001 for ALL of them, so `code`
 * cannot discriminate (design §8.4). Every test below therefore constructs
 * an error carrying a `code` that is either absent or deliberately wrong,
 * so a regression that reads `error.code` instead would fail these.
 */

describe('mapGuestError', () => {
  it('maps no_such_event to the bad-link copy', () => {
    const result = mapGuestError({ message: 'no_such_event', code: 'P0001' });
    expect(result).toEqual({ code: 'no_such_event', message: "That link isn't valid." });
  });

  it('maps event_not_live to the not-started-or-ended copy', () => {
    const result = mapGuestError({ message: 'event_not_live', code: 'P0001' });
    expect(result).toEqual({
      code: 'event_not_live',
      message: "This event hasn't started yet, or it's over.",
    });
  });

  it('maps suggestion_limit to the three-used copy', () => {
    const result = mapGuestError({ message: 'suggestion_limit', code: 'P0001' });
    expect(result.code).toBe('suggestion_limit');
    expect(result.message).toMatch(/used all three/i);
  });

  it('maps no_such_session and wrong_event to distinct codes with session-expired copy', () => {
    expect(mapGuestError({ message: 'no_such_session' }).code).toBe('no_such_session');
    expect(mapGuestError({ message: 'wrong_event' }).code).toBe('wrong_event');
  });

  it('falls back to a generic message for an unrecognized message', () => {
    const result = mapGuestError({ message: 'something_never_seen' });
    expect(result.code).toBe('unknown');
    expect(result.message).not.toMatch(/isn't valid|hasn't started/);
  });

  it('falls back to a generic message for a non-error-shaped value', () => {
    expect(mapGuestError('a plain string').code).toBe('unknown');
    expect(mapGuestError(null).code).toBe('unknown');
    expect(mapGuestError(undefined).code).toBe('unknown');
  });
});
