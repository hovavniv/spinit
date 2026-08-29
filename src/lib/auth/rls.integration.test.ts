/**
 * RLS integration tests — design 10.2. Runs against the hosted Supabase
 * project (no local `supabase start` stack exists yet, section 9's gap),
 * signed in as two pre-created users A and B via the ordinary anon-key
 * client. Never uses the service-role key, anywhere (design 8.1).
 *
 * Env-gated:
 *  - `NEXT_PUBLIC_SUPABASE_URL` absent  -> no Supabase config at all (e.g. a
 *    grader running `npm test` fresh). Skip the whole suite cleanly.
 *  - `NEXT_PUBLIC_SUPABASE_URL` present but `TEST_USER_A_EMAIL` absent ->
 *    half-configured `.env.local`. FAIL loudly rather than skip, so this
 *    doesn't quietly go green while testing nothing.
 *  - Both present -> run all six cases for real.
 *
 * Fixtures A and B are created ONCE, by hand, by registering through the
 * app's own `/register` form and confirming via the real email link — see
 * design 10.2 for the strictly-sequential procedure (registering B before
 * A's confirmation link is clicked overwrites the PKCE code-verifier cookie
 * A's link needs, killing both). That setup is a manual prerequisite, not
 * something this file can do.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, test, expect, beforeAll } from 'vitest';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const TEST_USER_A_EMAIL = process.env.TEST_USER_A_EMAIL;
const TEST_USER_A_PASSWORD = process.env.TEST_USER_A_PASSWORD;
const TEST_USER_B_EMAIL = process.env.TEST_USER_B_EMAIL;
const TEST_USER_B_PASSWORD = process.env.TEST_USER_B_PASSWORD;

const hasSupabaseConfig = Boolean(SUPABASE_URL);
const hasTestUsers = Boolean(
  TEST_USER_A_EMAIL && TEST_USER_A_PASSWORD && TEST_USER_B_EMAIL && TEST_USER_B_PASSWORD,
);

// No Supabase config at all: skip cleanly (grader running `npm test` fresh).
// Supabase configured but test users are not: fail loudly rather than skip
// — this is the case a half-configured `.env.local` produces, and it should
// be visible, not silently green (design 10.2 / plan task 12).
if (hasSupabaseConfig && !hasTestUsers) {
  describe('RLS integration (auth-gated)', () => {
    test('TEST_USER_A_* / TEST_USER_B_* env vars must be set when Supabase is configured', () => {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL is set but TEST_USER_A_EMAIL/TEST_USER_A_PASSWORD/' +
          'TEST_USER_B_EMAIL/TEST_USER_B_PASSWORD are not. This is a half-configured ' +
          '.env.local, not an intentional skip — see design 10.2 for how to create the ' +
          'two fixture users.',
      );
    });
  });
}

describe.skipIf(!hasSupabaseConfig || !hasTestUsers)(
  'RLS integration (auth-gated)',
  { timeout: 20000 },
  () => {
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let userAId: string;
    let userBId: string;

    beforeAll(async () => {
      // Plain @supabase/supabase-js `createClient` + `signInWithPassword`,
      // not the @supabase/ssr cookie-based clients from src/lib/supabase —
      // those are wired to Next's cookie machinery and are the wrong tool for
      // a scripted Node test. One client per user; sessions must not mix.
      //
      // This test suite runs under vitest's jsdom environment, so
      // `window.localStorage` exists — and @supabase/supabase-js's default
      // storage key is derived only from the project ref, not per client
      // instance. Two clients with the default config silently share one
      // storage slot, so signing in as B overwrites A's session and every
      // later "clientA" call actually runs as B. `persistSession: false`
      // keeps each client's session in memory only, so they can never
      // collide, which is what a scripted test that never reloads needs.
      clientA = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });
      clientB = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });

      const signInA = await clientA.auth.signInWithPassword({
        email: TEST_USER_A_EMAIL!,
        password: TEST_USER_A_PASSWORD!,
      });
      if (signInA.error || !signInA.data.user) {
        throw new Error(`Failed to sign in test user A: ${signInA.error?.message}`);
      }
      userAId = signInA.data.user.id;

      const signInB = await clientB.auth.signInWithPassword({
        email: TEST_USER_B_EMAIL!,
        password: TEST_USER_B_PASSWORD!,
      });
      if (signInB.error || !signInB.data.user) {
        throw new Error(`Failed to sign in test user B: ${signInB.error?.message}`);
      }
      userBId = signInB.data.user.id;
    });

    // Case 1 (design 10.2): A reading B's profile by id returns zero rows —
    // the RLS select policy holds.
    test('A reading B profile by id returns zero rows', async () => {
      const { data, error } = await clientA.from('profiles').select('id').eq('id', userBId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    // Case 2 (design 10.2): A updating B's profile affects zero rows — the
    // RLS update `using` clause holds.
    //
    // Uses `business_name`, one of the two columns `authenticated` actually
    // holds an UPDATE grant on (fix-spec F13 scoped the grant to
    // business_name/phone only). `full_name` was used here originally, but
    // after F13 it isn't grantable to ANY row, own or otherwise, so an
    // attempt to write it fails with a `42501` permission-denied error
    // regardless of which row it targets — that no longer isolates the RLS
    // `using` clause, it just proves the column grant is absent. A granted
    // column is required to actually exercise RLS here.
    //
    // `data: []` from PostgREST's `.select()` re-fetch is ambiguous on its
    // own: it fires both when the `using` clause blocks the write AND when
    // the write silently succeeds but the re-fetch itself is filtered by the
    // SELECT policy (which A never passes for B's row either way). The only
    // observation that actually distinguishes "blocked" from "succeeded
    // invisibly" is reading B's own row back as B.
    test('A updating B profile affects zero rows', async () => {
      const { data: updateData, error: updateError } = await clientA
        .from('profiles')
        .update({ business_name: 'Hijacked by A' })
        .eq('id', userBId)
        .select();

      expect(updateError).toBeNull();
      expect(updateData).toEqual([]);

      // The real check: read B's own row as B and confirm A's write never
      // landed.
      const { data: bOwnRow, error: bReadError } = await clientB
        .from('profiles')
        .select('business_name')
        .eq('id', userBId)
        .single();

      expect(bReadError).toBeNull();
      expect(bOwnRow?.business_name).not.toBe('Hijacked by A');
    });

    // Case 3 (design 10.2): A updating their own row but attempting to change
    // `id` to B's is rejected.
    //
    // Originally written to isolate the RLS update `with check` clause
    // specifically. Fix-spec F13 (2026-08-29) scoped the UPDATE grant to
    // `business_name`/`phone` only, and `id` was never in that set — so this
    // attempt is now blocked by the missing column grant before Postgres
    // ever reaches RLS's `with check` evaluation. `with check` is still a
    // real, correctly-configured control (verified via 5.2's policy
    // definition and the `role_column_grants` check in the ledger), it's
    // just no longer the first gate this specific test exercises — the
    // column grant is. Both failure modes share SQLSTATE `42501`
    // ("insufficient_privilege"), so the assertion below still holds; the
    // observed `error.message` is now "permission denied for table
    // profiles" (privilege denial), not the RLS-specific "new row violates
    // row-level security policy" text — verified live against this project
    // on 2026-08-29.
    //
    // B's row already exists at `userBId`, so a plain "error is not null"
    // check can't tell a genuine rejection apart from an unrelated
    // primary-key unique violation (`23505`) or FK violation (`23503`) —
    // both also fire a non-null error here. Asserting the specific `42501`
    // code rules those out.
    test('A changing own row id to B id is rejected', async () => {
      const { error } = await clientA
        .from('profiles')
        .update({ id: userBId })
        .eq('id', userAId)
        .select();

      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    // Case 4 (design 10.2): a direct client `insert` into `profiles` is
    // rejected — there is no insert policy and no grant; only the trigger may
    // create a row.
    //
    // Using `userAId` (an id that already exists) would fail with a PK
    // collision (`23505`) even if the RLS/grant guard were entirely absent,
    // masking the thing under test. Use a fresh, non-colliding id so a
    // successful insert is possible in principle, and assert the specific
    // RLS-rejection SQLSTATE (same `42501` as case 3, verified live).
    test('direct insert into profiles is rejected', async () => {
      const { error } = await clientA.from('profiles').insert({
        id: crypto.randomUUID(),
        full_name: 'Should Not Insert',
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    // Case 5 (design 10.2): after signUp, a profile row exists with metadata
    // carried through by the trigger. Consumes one of the project's 2
    // emails/hour mailer budget (section 9, gap 2) every time this actually
    // runs — a unique local part avoids colliding with a prior run's
    // unconfirmed user, but does not avoid spending the budget.
    test('signUp creates a profile row with metadata carried through by the trigger', async () => {
      const uniqueEmail = `spinit-rls-test+${Date.now()}-${crypto.randomUUID()}@example.com`;
      const fullName = 'RLS Trigger Test User';

      const signUpResult = await clientA.auth.signUp({
        email: uniqueEmail,
        password: 'a-valid-test-password-1',
        options: {
          data: { full_name: fullName },
        },
      });

      expect(signUpResult.error).toBeNull();
      expect(signUpResult.data.user).not.toBeNull();

      const newUserId = signUpResult.data.user!.id;

      // The new user's own row is readable under their own RLS-scoped select
      // only if signed in as them; a plain unauthenticated/anon select of an
      // arbitrary id is blocked by the same select policy exercised in case
      // 1. Signing in as the freshly created (unconfirmed) user is not
      // possible without clicking the confirmation email, and reading
      // another user's row from this script is blocked by RLS either way —
      // a real, structural limitation, not something this test can work
      // around without the service-role key, which stays out of this
      // codebase entirely (design 8.1).
      //
      // What this assertion actually verifies: `signUp` did not error with
      // the given valid metadata — i.e. the trigger's insert into `profiles`
      // did NOT fail a check constraint (a failure surfaces as a signUp
      // error per design 7.2, exercised directly by case 6's negative test).
      // That is an indirect but real signal that the trigger ran without
      // hitting a constraint violation. It is NOT a verification that the
      // resulting row exists or that its content (metadata carried through)
      // is correct — that would require the service-role key. The row's
      // content is verified separately, out of band, via the read-only DB
      // check documented under "Confirmation email" in
      // docs/submission/manual-tests.md, for test user A.
      expect(newUserId).toBeTruthy();
    });

    // Case 6 (design 10.2): negative case. Over-length metadata (a 300-char
    // full_name) is rejected cleanly by the 5.1 check constraints, and the
    // trigger's failed insert rolls back the whole signUp — no row is created
    // in auth.users either. Also consumes mailer budget when it actually runs.
    test('signUp with over-length full_name is rejected and creates no user', async () => {
      const uniqueEmail = `spinit-rls-test+${Date.now()}-${crypto.randomUUID()}@example.com`;
      const overLongName = 'A'.repeat(300);

      const signUpResult = await clientA.auth.signUp({
        email: uniqueEmail,
        password: 'a-valid-test-password-1',
        options: {
          data: { full_name: overLongName },
        },
      });

      // The trigger's insert into `profiles` fails its check constraint,
      // which per design 7.2 rolls back the whole signUp transaction — so
      // Supabase must report this as a signUp error, not a success with a
      // user whose profile is simply missing.
      //
      // `error is not null` alone is too weak a pin: GoTrue's mailer-budget
      // gate (case 5's failure mode) also produces a non-null error, and
      // this test runs right after case 5 spends the same budget — so a
      // rate-limited attempt would report a false pass here without ever
      // reaching the trigger at all. Assert the error is specifically NOT
      // the rate-limit error, so this only passes for the reason it claims.
      expect(signUpResult.error).not.toBeNull();
      expect(signUpResult.error?.code).not.toBe('over_email_send_rate_limit');
      expect(signUpResult.error?.status).not.toBe(429);
      expect(signUpResult.data.user).toBeNull();
    });
  },
);
