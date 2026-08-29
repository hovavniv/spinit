'use server';

import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { mapAuthError, type ActionResult } from '@/lib/auth/errors';
import { formDataToRecord, loginSchema, registerSchema, profileSchema, PHONE_PATTERN } from '@/lib/validation';

/**
 * The four server actions in scope for this chunk (design 4.1, 4.2, 4.4, 4.6).
 * `signInWithGoogle` is deliberately NOT implemented here: Google OAuth is
 * deferred (docs/specs/2026-08-29-supabase-auth-ledger.md — "Google OAuth
 * deferred to a later phase"), tracked as GitHub issue #2. Every design/plan
 * passage describing `signInWithGoogle` is out of scope for this file.
 */

/**
 * `SITE_URL`, never a request header — a forged `Host` / `X-Forwarded-Host`
 * header must not be able to influence a Supabase redirect URL (design 4.1,
 * design 4.3's open-redirect concern). This function does not read
 * `headers()` at all, which is itself the control: there is no code path
 * here that could be tricked into preferring a client-supplied origin.
 */
function siteUrl(): string {
  const url = process.env.SITE_URL;
  if (!url) {
    throw new Error('SITE_URL is not set');
  }
  return url;
}

/**
 * Zod's issues array can carry more than one error per field; only the first
 * is kept per field, matching `ActionResult`'s `formErrors: Record<string,
 * string>` shape (one message per field).
 */
function fieldErrorsFrom(error: ZodError): Record<string, string> {
  const formErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_form');
    if (!formErrors[key]) {
      formErrors[key] = issue.message;
    }
  }
  return formErrors;
}

/**
 * design 4.1. Re-parses `FormData` through `registerSchema` server-side —
 * client validation is for feedback only. `dialCode` is read directly off
 * the raw `FormData` (registerSchema is not `.strict()` and strips it from
 * its parsed output — see validation.ts), joined with the validated `phone`
 * field, and checked against the SAME `PHONE_PATTERN` the SQL `phone_fmt`
 * constraint mirrors — BEFORE calling `signUp`. Without this, a bad joined
 * value only fails inside the `handle_new_user` trigger, which GoTrue
 * reports as an opaque "Database error saving new user"; validating first
 * turns it into an ordinary field error on `phone` instead (design 4.1 step
 * 4, plan task 7).
 */
export async function signUpWithPassword(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) {
    return { ok: false, formErrors: fieldErrorsFrom(parsed.error) };
  }

  const dialCodeEntry = formData.get('dialCode');
  const dialCode = typeof dialCodeEntry === 'string' ? dialCodeEntry : '';
  const joinedPhone = `${dialCode}${parsed.data.phone}`;

  if (!PHONE_PATTERN.test(joinedPhone)) {
    return { ok: false, formErrors: { phone: 'Enter a valid phone number.' } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.name,
        business_name: parsed.data.businessName,
        phone: joinedPhone,
      },
      emailRedirectTo: `${siteUrl()}/auth/callback`,
    },
  });

  if (error) {
    return mapAuthError(error, { event: 'signup' });
  }

  // "check your email" — the caller/UI renders the copy for this state.
  return { ok: true };
}

/** design 4.2. Re-parses via `loginSchema`; redirects to /dashboard on success. */
export async function signInWithPassword(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) {
    return { ok: false, formErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return mapAuthError(error, { event: 'login' });
  }

  // redirect() throws internally — expected Next behavior, not caught here.
  redirect('/dashboard');
}

/**
 * design 4.4. `scope: 'local'` is explicit and mandatory — the library
 * default (`global`) would silently log the DJ out of every device/session,
 * which nothing in this product requires.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/');
}

/**
 * design 4.6, this chunk's only write path into `profiles`.
 * - `requireUser()` runs first: no unauthenticated caller reaches anything
 *   else.
 * - The row id comes from `requireUser()`'s verified session, NEVER from the
 *   submitted form — the IDOR guard, even if the form carries a hidden `id`
 *   field naming another user.
 * - The update payload is a fixed, hand-written object of exactly the two
 *   writable columns — never a spread of `parsed.data` or any other object
 *   that could carry extra keys through — the mass-assignment guard, defense
 *   in depth on top of `profileSchema` already only exposing those two keys.
 */
export async function updateProfile(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = profileSchema.safeParse(formDataToRecord(formData));
  if (!parsed.success) {
    return { ok: false, formErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({
      business_name: parsed.data.businessName,
      phone: parsed.data.phone,
    })
    .eq('id', user.id);

  if (error) {
    // errors.ts's AuthErrorContext['event'] union has no 'profile' case, and
    // extending it would touch a file from an earlier committed task
    // (out of scope here per the task brief). Applying design 7.2's rules
    // inline instead: no raw Supabase error reaches the client, and the
    // server-side log carries only the user id, never PII.
    console.error('updateProfile: failed to update profile', {
      userId: user.id,
      message: error.message,
    });
    return { ok: false, message: 'We could not save your profile. Please try again.' };
  }

  return { ok: true };
}
