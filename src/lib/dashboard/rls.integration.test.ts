/**
 * RLS integration tests for the new `events` table columns — plan task 11.
 * Runs against the hosted Supabase project, signed in as the same two
 * pre-created users A and B used by src/lib/auth/rls.integration.test.ts,
 * via the ordinary anon-key client. Never uses the service-role key.
 *
 * Env-gated:
 *  - `NEXT_PUBLIC_SUPABASE_URL` absent  -> no Supabase config at all (e.g. a
 *    grader running `npm test` fresh). Skip the whole suite cleanly.
 *  - `NEXT_PUBLIC_SUPABASE_URL` present but `TEST_USER_A_EMAIL` absent ->
 *    half-configured `.env.local`. FAIL loudly rather than skip, so this
 *    doesn't quietly go green while testing nothing.
 *  - Both present -> run all five cases for real.
 *
 * Fixtures A and B are the same manually-created users src/lib/auth's suite
 * uses (see that file's header for how they were created); this suite signs
 * in as them directly and never calls `signUp`, so it does not touch the
 * mailer budget.
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
// be visible, not silently green.
if (hasSupabaseConfig && !hasTestUsers) {
  describe('Dashboard RLS integration (auth-gated)', () => {
    test('TEST_USER_A_* / TEST_USER_B_* env vars must be set when Supabase is configured', () => {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL is set but TEST_USER_A_EMAIL/TEST_USER_A_PASSWORD/' +
          'TEST_USER_B_EMAIL/TEST_USER_B_PASSWORD are not. This is a half-configured ' +
          '.env.local, not an intentional skip — see src/lib/auth/rls.integration.test.ts ' +
          'for how to create the two fixture users.',
      );
    });
  });
}

describe.skipIf(!hasSupabaseConfig || !hasTestUsers)(
  'Dashboard RLS integration (auth-gated)',
  { timeout: 20000 },
  () => {
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let userAId: string;
    let userBId: string;
    let eventAId: string;

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

    test('DJ A can insert an event with the new columns', async () => {
      // status: 'draft', not 'upcoming' — this insert has no teardown (public.events
      // grants no delete and defines no delete policy, so a client-side cleanup
      // cannot work regardless), so every run of this suite leaves this row in the
      // live database permanently. 'draft' is invisible to every query this repo
      // runs today (listActiveEvents only reads 'upcoming'/'live';
      // past_events_with_counts carries only completed and date-passed upcoming
      // rows (the status conjunct in 20260904120000 is what excludes these
      // drafts, and it is load-bearing: without it they would surface on
      // 2026-12-02)), so the leak no longer renders as a phantom card on a real
      // DJ's dashboard. It does not fix the
      // accumulation itself — that needs a delete policy, a decision recorded as
      // open in the ledger, not made here.
      const { data, error } = await clientA
        .from('events')
        .insert({
          dj_id: userAId,
          couple_names: 'RLS Test A',
          venue: 'Test Venue',
          event_date: '2026-12-01',
          status: 'draft',
          phase: 'dinner',
          start_time: '19:30:00',
          couple_status: 'streaming-connected',
        })
        .select('id')
        .single();

      expect(error).toBeNull();
      eventAId = data!.id;
    });

    test("DJ B reads none of A's events, new columns included", async () => {
      const { data, error } = await clientB
        .from('events')
        .select('id, phase, start_time, couple_status')
        .eq('id', eventAId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    test("DJ B cannot change the phase of A's event", async () => {
      const { data, error } = await clientB
        .from('events')
        .update({ phase: 'last-dance' })
        .eq('id', eventAId)
        .select('id');

      expect(error).toBeNull();
      // Zero rows affected, not an error: RLS filters the row out of the
      // update's scope rather than rejecting the statement.
      expect(data).toEqual([]);
    });

    test('DJ A cannot hand their own event to DJ B', async () => {
      const { error } = await clientA
        .from('events')
        .update({ dj_id: userBId })
        .eq('id', eventAId)
        .select('id');

      // Rejected by the policy's `with check`, which decides what a row may
      // BECOME — `using` alone would allow this.
      expect(error).not.toBeNull();
    });

    test('phase rejects a value outside the enum', async () => {
      const { error } = await clientA
        .from('events')
        .update({ phase: 'karaoke' })
        .eq('id', eventAId);

      expect(error).not.toBeNull();
    });
  },
);
