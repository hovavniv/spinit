import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * actions.ts pulls in lib/supabase/server (next/headers) and lib/auth/dal
 * (import 'server-only'), neither importable from jsdom (design section 6 /
 * design 10.3's note about the same problem on the component side). Both are
 * mocked below so the real files are never evaluated; the Supabase client and
 * requireUser() are therefore fully test-doubled, never the live project.
 */

const { signUp, signInWithPassword, signOut, updateEq, update, from, requireUser, redirect } = vi.hoisted(() => {
  const updateEq = vi.fn();
  const update = vi.fn<(payload: Record<string, unknown>) => { eq: typeof updateEq }>(() => ({
    eq: updateEq,
  }));
  const from = vi.fn(() => ({ update }));
  return {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    updateEq,
    update,
    from,
    requireUser: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    }),
  };
});

const supabaseClient = {
  auth: { signUp, signInWithPassword, signOut },
  from,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseClient),
}));

vi.mock('@/lib/auth/dal', () => ({
  requireUser,
}));

vi.mock('next/navigation', () => ({
  redirect,
}));

// Every test that reaches a header-derived origin sets a hostile Host /
// X-Forwarded-Host so a test that accidentally reads from request headers
// (instead of SITE_URL) would produce an attacker-controlled URL and fail.
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Map([
    ['host', 'evil.com'],
    ['x-forwarded-host', 'evil.com'],
  ])),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Wraps the real mapAuthError so F6's assertions can inspect what actions.ts
// actually passed in as `context`, without re-implementing errors.ts's own
// logic (which errors.test.ts already pins independently).
vi.mock('@/lib/auth/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/errors')>();
  return { ...actual, mapAuthError: vi.fn(actual.mapAuthError) };
});

import { revalidatePath } from 'next/cache';
import { mapAuthError } from '@/lib/auth/errors';
import { signUpWithPassword, signInWithPassword as signInAction, signOut as signOutAction, updateProfile } from './actions';

function registerFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    name: 'Jordan Ellis',
    businessName: 'Ellis Sound Co.',
    email: 'jordan@example.com',
    confirmEmail: 'jordan@example.com',
    phone: '(555) 123-4567',
    dialCode: '+1',
    password: 'correct-horse-battery',
    confirmPassword: 'correct-horse-battery',
  };
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    fd.set(key, value);
  }
  return fd;
}

function loginFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    email: 'jordan@example.com',
    password: 'correct-horse-battery',
  };
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    fd.set(key, value);
  }
  return fd;
}

function profileFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    businessName: 'Ellis Sound Co.',
    phone: '+1(555) 123-4567',
  };
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SITE_URL = 'http://localhost:3000';
  update.mockImplementation(() => ({ eq: updateEq }));
  from.mockImplementation(() => ({ update }));
  updateEq.mockResolvedValue({ error: null });
  signUp.mockResolvedValue({ data: {}, error: null });
  signInWithPassword.mockResolvedValue({ data: {}, error: null });
  signOut.mockResolvedValue({ error: null });
});

describe('updateProfile — IDOR guard', () => {
  it('always issues .eq("id", <session id>), never the id from the form', async () => {
    requireUser.mockResolvedValue({ id: 'session-user-id' });
    const fd = profileFormData({ id: 'someone-elses-id' });

    await updateProfile({ ok: true }, fd);

    expect(updateEq).toHaveBeenCalledWith('id', 'session-user-id');
    expect(updateEq).not.toHaveBeenCalledWith('id', 'someone-elses-id');
  });
});

describe('updateProfile — mass assignment guard', () => {
  it('does not pass extra full_name/created_at keys into the update payload', async () => {
    requireUser.mockResolvedValue({ id: 'session-user-id' });
    const fd = profileFormData({
      full_name: 'Someone Else',
      created_at: '1970-01-01T00:00:00.000Z',
    });

    await updateProfile({ ok: true }, fd);

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload).toEqual({ business_name: 'Ellis Sound Co.', phone: '+1(555) 123-4567' });
    expect(payload).not.toHaveProperty('full_name');
    expect(payload).not.toHaveProperty('created_at');
    expect(payload).not.toHaveProperty('id');
  });
});

describe('signOut', () => {
  it('calls supabase.auth.signOut with scope: local, not the global default', async () => {
    await expect(signOutAction()).rejects.toThrow('REDIRECT:/');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('signUpWithPassword — emailRedirectTo origin', () => {
  it('builds emailRedirectTo from SITE_URL even with hostile Host headers present', async () => {
    const fd = registerFormData();

    await signUpWithPassword({ ok: true }, fd);

    expect(signUp).toHaveBeenCalledTimes(1);
    const args = signUp.mock.calls[0][0];
    expect(args.options.emailRedirectTo).toBe('http://localhost:3000/auth/callback');
    expect(args.options.emailRedirectTo).not.toContain('evil.com');
  });
});

describe('signInWithPassword', () => {
  it('calls supabase.auth.signInWithPassword with the submitted credentials and redirects on success', async () => {
    const fd = loginFormData();

    await expect(signInAction({ ok: true }, fd)).rejects.toThrow('REDIRECT:/dashboard');

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'jordan@example.com',
      password: 'correct-horse-battery',
    });
  });
});

describe('signUpWithPassword — error diagnostics (F6)', () => {
  it('passes the Supabase error code as constraint, never the raw message', async () => {
    signUp.mockResolvedValue({ data: {}, error: { code: 'over_email_send_rate_limit', message: 'do not leak this text' } });
    const fd = registerFormData();

    await signUpWithPassword({ ok: true }, fd);

    expect(mapAuthError).toHaveBeenCalledTimes(1);
    const context = (mapAuthError as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(context.constraint).toBe('over_email_send_rate_limit');
    expect(context.constraint).not.toContain('do not leak this text');
  });
});

describe('signInWithPassword — error diagnostics (F6)', () => {
  it('passes the Supabase error code as constraint, never the raw message', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', message: 'do not leak this text' } });
    const fd = loginFormData();

    await signInAction({ ok: true }, fd);

    expect(mapAuthError).toHaveBeenCalledTimes(1);
    const context = (mapAuthError as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(context.constraint).toBe('invalid_credentials');
    expect(context.constraint).not.toContain('do not leak this text');
  });
});

describe('signUpWithPassword — emailRedirectTo with a trailing-slash SITE_URL (F12)', () => {
  it('strips the trailing slash so the URL never has a double slash', async () => {
    process.env.SITE_URL = 'http://localhost:3000/';
    const fd = registerFormData();

    await signUpWithPassword({ ok: true }, fd);

    const args = signUp.mock.calls[0][0];
    expect(args.options.emailRedirectTo).toBe('http://localhost:3000/auth/callback');
    expect(args.options.emailRedirectTo).not.toContain('//auth/callback');
  });
});

describe('updateProfile — dashboard refresh (F8)', () => {
  it('revalidates /dashboard after a successful save', async () => {
    requireUser.mockResolvedValue({ id: 'session-user-id' });
    const fd = profileFormData();

    const result = await updateProfile({ ok: true }, fd);

    expect(result).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
  });

  it('does not revalidate when the update fails', async () => {
    requireUser.mockResolvedValue({ id: 'session-user-id' });
    updateEq.mockResolvedValue({ error: { message: 'boom' } });
    const fd = profileFormData();

    await updateProfile({ ok: true }, fd);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('signUpWithPassword — dial-code + phone join validation', () => {
  it('rejects a joined value that fails the phone format check, without calling signUp', async () => {
    // Baked-in flag emoji from the current (buggy) <select> value, per design
    // 4.1 — the joined string this produces can never match phone_fmt.
    const fd = registerFormData({ dialCode: '🇺🇸 +1' });

    const result = await signUpWithPassword({ ok: true }, fd);

    expect(signUp).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok && 'formErrors' in result) {
      expect(result.formErrors.phone).toBeTruthy();
    } else {
      throw new Error('expected a formErrors result with a phone field error');
    }
  });
});
