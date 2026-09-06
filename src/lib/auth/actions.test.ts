import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * actions.ts pulls in lib/supabase/server (next/headers) and lib/auth/dal
 * (import 'server-only'), neither importable from jsdom (design section 6 /
 * design 10.3's note about the same problem on the component side). Both are
 * mocked below so the real files are never evaluated; the Supabase client and
 * requireUser() are therefore fully test-doubled, never the live project.
 */

const {
  signUp,
  signInWithPassword,
  signOut,
  updateEq,
  update,
  from,
  eventsLimit,
  partnersLimit,
  requireUser,
  redirect,
  cookieSet,
  cookieStore,
  selectEqCalls,
} = vi.hoisted(() => {
  const updateEq = vi.fn();
  const update = vi.fn<(payload: Record<string, unknown>) => { eq: typeof updateEq }>(() => ({
    eq: updateEq,
  }));
  // signInWithPassword also queries `events`/`event_partners` (existence
  // checks for postLoginPath) via the same `from`. Keyed by table so a test
  // can make the two checks disagree (owns no events, but is a partner).
  const eventsLimit = vi.fn();
  const partnersLimit = vi.fn();
  const limitByTable: Record<string, typeof eventsLimit> = {
    events: eventsLimit,
    event_partners: partnersLimit,
  };
  // Records the actual (table, column, value) triple each .eq() call after
  // .select() was made with, so a test can assert the real predicate value --
  // not just which tables were queried.
  const selectEqCalls: [string, string, unknown][] = [];
  const from = vi.fn((table: string) => ({
    update,
    select: vi.fn(() => ({
      eq: vi.fn((column: string, value: unknown) => {
        selectEqCalls.push([table, column, value]);
        return { limit: limitByTable[table] };
      }),
    })),
  }));
  const cookieSet = vi.fn();
  const cookieStore = { set: cookieSet };
  return {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    updateEq,
    update,
    from,
    eventsLimit,
    partnersLimit,
    requireUser: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    }),
    cookieSet,
    cookieStore,
    selectEqCalls,
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
  cookies: vi.fn(async () => cookieStore),
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
  selectEqCalls.length = 0;
  process.env.SITE_URL = 'http://localhost:3000';
  update.mockImplementation(() => ({ eq: updateEq }));
  updateEq.mockResolvedValue({ error: null });
  signUp.mockResolvedValue({ data: {}, error: null });
  signInWithPassword.mockResolvedValue({ data: { user: { id: 'session-user-id' } }, error: null });
  signOut.mockResolvedValue({ error: null });
  // Default: signed-in user owns no events and links to no event. Individual
  // signInWithPassword tests override one or both to exercise postLoginPath.
  eventsLimit.mockResolvedValue({ data: [], error: null });
  partnersLimit.mockResolvedValue({ data: [], error: null });
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

function partnerFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    mode: 'partner',
    name: 'Jordan Ellis',
    email: 'jordan@example.com',
    confirmEmail: 'jordan@example.com',
    password: 'correct-horse-battery',
    confirmPassword: 'correct-horse-battery',
  };
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    fd.set(key, value);
  }
  return fd;
}

// §8's test table claims a unit test exists pinning: "a non-uuid invite or a
// slot outside {1,2} sets no cookie at all." It did not exist before this
// fix-spec (design doc §8 correction, 2026-09-03). Written here because the
// validation this claims to pin lives inside signUpWithPassword itself
// (`safeRedirect` falling back to the literal '/dashboard'), not in the
// /register page component.
describe('signUpWithPassword — invalid invitePath sets no cookie', () => {
  it('never calls cookies().set when invitePath is not a valid /invite/<uuid>/{1,2} path', async () => {
    const fd = partnerFormData({ invitePath: '/invite/not-a-uuid/1' });

    await signUpWithPassword({ ok: true }, fd);

    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('never calls cookies().set when the slot is outside {1,2}', async () => {
    const fd = partnerFormData({
      invitePath: '/invite/11111111-1111-4111-8111-111111111111/3',
    });

    await signUpWithPassword({ ok: true }, fd);

    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('DOES call cookies().set for a genuinely valid invite path, so the two tests above are pinning the guard and not a permanently-off branch', async () => {
    const fd = partnerFormData({
      invitePath: '/invite/11111111-1111-4111-8111-111111111111/1',
    });

    await signUpWithPassword({ ok: true }, fd);

    expect(cookieSet).toHaveBeenCalledWith(
      expect.any(String),
      '/invite/11111111-1111-4111-8111-111111111111/1',
      expect.anything(),
    );
  });

  // Fix-spec item 4 (2026-09-03): the cookie write moved to AFTER signUp
  // succeeds. Before the fix it ran unconditionally ahead of the signUp
  // call, so a failed signup still left the cookie set -- a stray 30-minute
  // misroute for the next person to sign up in the same browser.
  it('does not call cookies().set when signUp itself fails, even with a valid invite path', async () => {
    signUp.mockResolvedValue({ data: {}, error: { message: 'boom', code: 'unexpected_failure' } });
    const fd = partnerFormData({
      invitePath: '/invite/11111111-1111-4111-8111-111111111111/1',
    });

    await signUpWithPassword({ ok: true }, fd);

    expect(cookieSet).not.toHaveBeenCalled();
  });
});

// The device-independent half of the invite handoff (2026-09-06). The cookie
// above only reaches a partner who confirms in the same browser; these pin the
// copy that travels on the account instead.
describe('signUpWithPassword — invite path on user metadata', () => {
  const VALID = '/invite/11111111-1111-4111-8111-111111111111/1';

  it('sends the validated invite path in options.data so it survives a different device', async () => {
    await signUpWithPassword({ ok: true }, partnerFormData({ invitePath: VALID }));

    expect(signUp).toHaveBeenCalledTimes(1);
    expect(signUp.mock.calls[0][0].options.data.invite_path).toBe(VALID);
  });

  it('sends an empty invite path for a DJ signup, even when an invite path was supplied', async () => {
    await signUpWithPassword({ ok: true }, registerFormData({ invitePath: VALID }));

    expect(signUp.mock.calls[0][0].options.data.invite_path).toBe('');
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('stores nothing for a tampered invite path, rather than the /dashboard fallback string', async () => {
    // safeRedirect returns '/dashboard' for anything invalid, and storing that
    // literal would make every partner's metadata claim a destination it does
    // not have. The reader treats '' and '/dashboard' alike, but only '' says
    // "no invitation" honestly.
    await signUpWithPassword({ ok: true }, partnerFormData({ invitePath: '//evil.com' }));

    const stored = signUp.mock.calls[0][0].options.data.invite_path;
    expect(stored).toBe('');
    expect(stored).not.toContain('evil.com');
  });

  it('still sends the three profile keys handle_new_user actually reads', async () => {
    // The new key rides in the same blob as these; a regression that replaced
    // options.data rather than extending it would break signup outright.
    await signUpWithPassword({ ok: true }, registerFormData());

    const data = signUp.mock.calls[0][0].options.data;
    expect(data.full_name).toBe('Jordan Ellis');
    expect(typeof data.business_name).toBe('string');
    expect(typeof data.phone).toBe('string');
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

  it('sends a DJ (owns events) to /dashboard even if also a partner', async () => {
    eventsLimit.mockResolvedValue({ data: [{ id: 'owned-1' }], error: null });
    partnersLimit.mockResolvedValue({ data: [{ id: 'link-1' }], error: null });

    await expect(signInAction({ ok: true }, loginFormData())).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('sends a partner who owns no events to /my-event', async () => {
    eventsLimit.mockResolvedValue({ data: [], error: null });
    partnersLimit.mockResolvedValue({ data: [{ id: 'link-1' }], error: null });

    await expect(signInAction({ ok: true }, loginFormData())).rejects.toThrow('REDIRECT:/my-event');
  });

  it('sends a user who is neither a DJ nor a partner to /dashboard', async () => {
    eventsLimit.mockResolvedValue({ data: [], error: null });
    partnersLimit.mockResolvedValue({ data: [], error: null });

    await expect(signInAction({ ok: true }, loginFormData())).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('scopes both existence checks to the signed-in user, not the form', async () => {
    // Asserting only WHICH tables were queried (the previous version of this
    // test) would still pass if the predicate were swapped to filter on form
    // data instead of the signed-in user's id -- neither `from('events')` nor
    // `from('event_partners')` changes. Capture the actual .eq() column/value
    // pairs instead, so the real filter is what's pinned.
    await expect(signInAction({ ok: true }, loginFormData())).rejects.toThrow();

    expect(selectEqCalls).toContainEqual(['events', 'dj_id', 'session-user-id']);
    expect(selectEqCalls).toContainEqual(['event_partners', 'user_id', 'session-user-id']);
  });

  it('redirects to a valid invite path from the hidden invitePath field, bypassing postLoginPath', async () => {
    const fd = loginFormData({ invitePath: '/invite/11111111-1111-4111-8111-111111111111/1' });

    await expect(signInAction({ ok: true }, fd)).rejects.toThrow(
      'REDIRECT:/invite/11111111-1111-4111-8111-111111111111/1',
    );
  });

  it('falls through to postLoginPath when invitePath is a tampered open-redirect attempt', async () => {
    const fd = loginFormData({ invitePath: '//evil.com' });

    await expect(signInAction({ ok: true }, fd)).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('falls through to postLoginPath when invitePath names an invalid slot', async () => {
    const fd = loginFormData({ invitePath: '/invite/11111111-1111-4111-8111-111111111111/3' });

    await expect(signInAction({ ok: true }, fd)).rejects.toThrow('REDIRECT:/dashboard');
  });

  // 2026-09-06. A partner who confirmed on a different device was sent to
  // /dashboard once; without this they would be sent there on every later
  // login too, because nothing marks them a partner until they claim, and they
  // cannot claim from a page they never reach.
  describe('remembered invite on user metadata', () => {
    const REMEMBERED = '/invite/11111111-1111-4111-8111-111111111111/2';

    function signedInWith(metadata: Record<string, unknown>) {
      signInWithPassword.mockResolvedValue({
        data: { user: { id: 'session-user-id', user_metadata: metadata } },
        error: null,
      });
    }

    it('routes a partner who has not claimed yet to their remembered invite', async () => {
      eventsLimit.mockResolvedValue({ data: [], error: null });
      partnersLimit.mockResolvedValue({ data: [], error: null });
      signedInWith({ invite_path: REMEMBERED });

      await expect(signInAction({ ok: true }, loginFormData())).rejects.toThrow(
        `REDIRECT:${REMEMBERED}`,
      );
    });

    it('prefers the submitted invitePath field over the remembered one', async () => {
      const submitted = '/invite/11111111-1111-4111-8111-111111111111/1';
      eventsLimit.mockResolvedValue({ data: [], error: null });
      partnersLimit.mockResolvedValue({ data: [], error: null });
      signedInWith({ invite_path: REMEMBERED });

      await expect(
        signInAction({ ok: true }, loginFormData({ invitePath: submitted })),
      ).rejects.toThrow(`REDIRECT:${submitted}`);
    });

    it('sends an already-claimed partner to /my-event, not back to a claim page', async () => {
      eventsLimit.mockResolvedValue({ data: [], error: null });
      partnersLimit.mockResolvedValue({ data: [{ id: 'link-1' }], error: null });
      signedInWith({ invite_path: REMEMBERED });

      await expect(signInAction({ ok: true }, loginFormData())).rejects.toThrow(
        'REDIRECT:/my-event',
      );
    });

    it('sends a DJ to /dashboard even with an invite path on their metadata', async () => {
      eventsLimit.mockResolvedValue({ data: [{ id: 'owned-1' }], error: null });
      partnersLimit.mockResolvedValue({ data: [], error: null });
      signedInWith({ invite_path: REMEMBERED });

      await expect(signInAction({ ok: true }, loginFormData())).rejects.toThrow(
        'REDIRECT:/dashboard',
      );
    });

    it('refuses a forged metadata value, which auth.updateUser can set to anything', async () => {
      eventsLimit.mockResolvedValue({ data: [], error: null });
      partnersLimit.mockResolvedValue({ data: [], error: null });
      signedInWith({ invite_path: 'https://evil.com/steal' });

      await expect(signInAction({ ok: true }, loginFormData())).rejects.toThrow(
        'REDIRECT:/dashboard',
      );
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
