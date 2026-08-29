import { describe, expect, it, vi } from 'vitest';
import { logAuthError, mapAuthError } from './errors';

describe('mapAuthError — login enumeration', () => {
  it('maps "invalid credentials" and "user not found" to the same message', () => {
    const logger = vi.fn();
    const invalidCredentials = mapAuthError(
      new Error('Invalid login credentials'),
      { event: 'login' },
      logger,
    );
    const userNotFound = mapAuthError(
      new Error('User not found'),
      { event: 'login' },
      logger,
    );

    expect(invalidCredentials.ok).toBe(false);
    expect(userNotFound.ok).toBe(false);
    if (invalidCredentials.ok || userNotFound.ok) {
      throw new Error('expected both results to be failures');
    }
    expect('message' in invalidCredentials ? invalidCredentials.message : '').toBe(
      'message' in userNotFound ? userNotFound.message : '',
    );
  });
});

describe('mapAuthError — no leakage to the client', () => {
  it('never surfaces the raw Supabase error message', () => {
    const logger = vi.fn();
    const rawMessage = 'AuthApiError: relation "public.profiles" violates constraint xyz';
    const result = mapAuthError(new Error(rawMessage), { event: 'signup' }, logger);
    const output = result.ok ? '' : 'message' in result ? result.message : JSON.stringify(result.formErrors);
    expect(output).not.toContain(rawMessage);
    expect(output).not.toContain('AuthApiError');
  });

  it('never surfaces a URL from the error or context', () => {
    const logger = vi.fn();
    const result = mapAuthError(
      new Error('redirect failed for https://internal.supabase.co/auth/v1/token'),
      { event: 'oauth' },
      logger,
    );
    const output = result.ok ? '' : 'message' in result ? result.message : JSON.stringify(result.formErrors);
    expect(output).not.toContain('http://');
    expect(output).not.toContain('https://');
  });

  it('never echoes submitted user input (email) back in the message', () => {
    const logger = vi.fn();
    const submittedEmail = 'attacker+probe@example.com';
    const result = mapAuthError(
      new Error(`no user found for ${submittedEmail}`),
      { event: 'login', email: submittedEmail },
      logger,
    );
    const output = result.ok ? '' : 'message' in result ? result.message : JSON.stringify(result.formErrors);
    expect(output).not.toContain(submittedEmail);
  });

  it('never echoes submitted user input (arbitrary string) back in the message', () => {
    const logger = vi.fn();
    const arbitrary = '<script>alert(1)</script>';
    const result = mapAuthError(new Error(arbitrary), { event: 'signup' }, logger);
    const output = result.ok ? '' : 'message' in result ? result.message : JSON.stringify(result.formErrors);
    expect(output).not.toContain(arbitrary);
  });
});

describe('mapAuthError — server-side logging contains no PII', () => {
  it('logs no email (@) and no digit run matching a submitted phone number', () => {
    const logger = vi.fn();
    const email = 'djcouple@example.com';
    const phone = '+15551234567';
    mapAuthError(
      new Error('Database error saving new user'),
      { event: 'signup', userId: 'user-123', email, phone, constraint: 'phone_fmt' },
      logger,
    );

    expect(logger).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.stringify(logger.mock.calls[0]);
    expect(loggedPayload).not.toContain('@');
    expect(loggedPayload).not.toContain('5551234567');
    expect(loggedPayload).not.toContain(phone);
  });

  it('logAuthError includes the user id and constraint when available', () => {
    const logger = vi.fn();
    logAuthError({ event: 'signup', userId: 'user-abc', constraint: 'phone_fmt' }, logger);

    expect(logger).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.stringify(logger.mock.calls[0]);
    expect(loggedPayload).toContain('user-abc');
    expect(loggedPayload).toContain('phone_fmt');
  });
});

describe('mapAuthError — signup trigger failure', () => {
  it('maps a "Database error saving new user" failure to the same generic signup message as any other signup failure', () => {
    const logger = vi.fn();
    const triggerFailure = mapAuthError(
      new Error('Database error saving new user'),
      { event: 'signup', constraint: 'full_name_len' },
      logger,
    );
    const otherFailure = mapAuthError(new Error('some other signup problem'), { event: 'signup' }, logger);

    expect(triggerFailure.ok).toBe(false);
    expect(otherFailure.ok).toBe(false);
    const triggerMessage = !triggerFailure.ok && 'message' in triggerFailure ? triggerFailure.message : '';
    const otherMessage = !otherFailure.ok && 'message' in otherFailure ? otherFailure.message : '';
    expect(triggerMessage).toBe(otherMessage);
    expect(triggerMessage).not.toMatch(/full_name|phone|constraint/i);
  });
});
