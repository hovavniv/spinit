/**
 * RLS integration tests for events / played_songs / past_events_with_counts.
 * docs/specs/2026-08-29-past-events-design.md §9.
 *
 * Gating is identical to src/lib/auth/rls.integration.test.ts: no Supabase
 * config at all -> skip cleanly; Supabase configured but test users missing
 * -> fail loudly, because that is a half-configured .env.local and it should
 * not go quietly green while testing nothing.
 *
 * Runs against whatever .env.local points at, signed in as two pre-created
 * users via the ordinary anon-key client. Never uses a service-role key.
 *
 * PREREQUISITE: `npm run seed:demo` has been run for user A.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, test, expect, beforeAll } from 'vitest';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const A_EMAIL = process.env.TEST_USER_A_EMAIL;
const A_PASSWORD = process.env.TEST_USER_A_PASSWORD;
const B_EMAIL = process.env.TEST_USER_B_EMAIL;
const B_PASSWORD = process.env.TEST_USER_B_PASSWORD;

const hasSupabaseConfig = Boolean(SUPABASE_URL);
const hasTestUsers = Boolean(A_EMAIL && A_PASSWORD && B_EMAIL && B_PASSWORD);

if (hasSupabaseConfig && !hasTestUsers) {
  describe('events RLS integration (auth-gated)', () => {
    test('TEST_USER_A_* / TEST_USER_B_* must be set when Supabase is configured', () => {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL is set but the TEST_USER_A_*/TEST_USER_B_* vars are not. ' +
          'This is a half-configured .env.local, not an intentional skip.',
      );
    });
  });
}

describe.skipIf(!hasSupabaseConfig || !hasTestUsers)(
  'events RLS integration (auth-gated)',
  { timeout: 20000 },
  () => {
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let userAId: string;
    let userBId: string;
    let anEventOfA: string;

    beforeAll(async () => {
      // persistSession: false is load-bearing, not tidiness. This suite runs
      // under vitest's jsdom environment, so window.localStorage exists, and
      // supabase-js derives its default storage key from the PROJECT REF
      // only -- not per client instance. Two clients with the default config
      // silently share one storage slot, so signing in as B overwrites A's
      // session and every later `clientA` call actually runs as B. Every
      // "B sees zero of A's rows" assertion below would then be comparing a
      // user against themselves and passing for the wrong reason.
      //
      // Keeping each session in memory only is what a scripted test that
      // never reloads needs. This is the same fix src/lib/auth/rls.integration
      // .test.ts already carries on feat/supabase-auth -- note that THIS
      // worktree's copy of that file predates the fix, so do not copy the
      // client construction from the version on disk here.
      clientA = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });
      clientB = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });

      const a = await clientA.auth.signInWithPassword({ email: A_EMAIL!, password: A_PASSWORD! });
      if (a.error || !a.data.user) throw new Error(`sign in A failed: ${a.error?.message}`);
      userAId = a.data.user.id;

      const b = await clientB.auth.signInWithPassword({ email: B_EMAIL!, password: B_PASSWORD! });
      if (b.error || !b.data.user) throw new Error(`sign in B failed: ${b.error?.message}`);
      userBId = b.data.user.id;

      // Named, not "any completed event": the seed creates THREE completed
      // events and one of them ('Ruth & Adam') deliberately has zero songs.
      // Without an explicit name, Postgres may hand back that one, and the
      // re-parenting test below then fails with a message about the seed --
      // a false alarm inside the security suite, different run to run.
      const { data, error } = await clientA
        .from('events')
        .select('id')
        .eq('couple_names', 'Noa & Eitan')
        .limit(1);
      if (error) {
        throw new Error(`could not read user A's events: ${error.message}`);
      }
      if (!data || data.length === 0) {
        throw new Error("No 'Noa & Eitan' event for user A. Run `npm run seed:demo` first.");
      }
      anEventOfA = data[0].id;
    });

    test('A sees only their own events', async () => {
      const { data, error } = await clientA.from('events').select('id, dj_id');
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
      expect(data!.every((row) => row.dj_id === userAId)).toBe(true);
    });

    // The security_invoker check. If the view were left at its default,
    // Postgres would apply the view OWNER's policies -- and that owner
    // carries rolbypassrls -- so this returns A's row and fails loudly.
    test('B reads zero of A rows THROUGH THE VIEW', async () => {
      const { data, error } = await clientB
        .from('past_events_with_counts')
        .select('id')
        .eq('id', anEventOfA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    test('B updating an event of A affects zero rows', async () => {
      const { data, error } = await clientB
        .from('events')
        .update({ venue: 'Hijacked by B' })
        .eq('id', anEventOfA)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    test('A cannot reassign their own event to B', async () => {
      const { data, error } = await clientA
        .from('events')
        .update({ dj_id: userBId })
        .eq('id', anEventOfA)
        .select();
      if (error) {
        expect(error).not.toBeNull();
      } else {
        expect(data).toEqual([]);
      }
    });

    test('B reads zero played_songs of A events', async () => {
      const { data, error } = await clientB
        .from('played_songs')
        .select('id')
        .eq('event_id', anEventOfA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    test('B cannot insert a played_song into an event of A', async () => {
      const { error } = await clientB.from('played_songs').insert({
        event_id: anEventOfA,
        position: 999,
        title: 'Injected',
        artist: 'B',
      });
      expect(error).not.toBeNull();
    });

    // CORRECTED 2026-08-29 -- this test originally predicted the opposite
    // ordering and said so out loud: "if this ever comes back 42501 instead,
    // the FK stopped being the first line of defence and this test's name is
    // wrong." Run live, reproducibly (twice, identical), it came back 42501.
    // The prediction was wrong, not the database.
    //
    // Why 42501 and not 23503: Postgres evaluates a policy's WITH CHECK as
    // part of the executor's row processing for the UPDATE -- before the row
    // is written to the heap. The FK's enforcement is an AFTER ROW trigger,
    // queued only once the write succeeds and fired at end of statement. A
    // WITH CHECK failure aborts before the row is ever written, so the FK
    // trigger that would raise 23503 never gets a chance to run. RLS is
    // genuinely the first line of defence here, not the FK.
    //
    // This also changes design §9 case 7's status, and the argument is worth
    // stating precisely rather than just asserting it. The `with check`
    // predicate is `exists (select 1 from events e where e.id =
    // played_songs.event_id and e.dj_id = (select auth.uid()))`. That
    // expression evaluates to the same `false` whether the referenced event
    // does not exist at all or exists and belongs to another DJ -- both are
    // "no row where e.id = this value AND e.dj_id = me," the same predicate,
    // the same code path. So this test exercises the identical mechanism case
    // 7 was written to exercise, without needing a real event owned by B and
    // without the permanent-litter cost design §11 gap 8 describes. Treated
    // here as CLOSING case 7, not as a stand-in for it -- Task 13's reviewer
    // has been asked to check this argument specifically, since it is an
    // inference about Postgres's semantics, not a difference proven by two
    // separate live runs the way the SQLSTATE correction above is.
    test("a song cannot be re-parented onto an event the caller does not own (RLS's WITH CHECK, not the FK)", async () => {
      const { data: songs } = await clientA
        .from('played_songs')
        .select('id')
        .eq('event_id', anEventOfA)
        .limit(1);
      if (!songs || songs.length === 0) {
        throw new Error('No played_songs for that event. Run `npm run seed:demo` first.');
      }

      const nonexistentEventId = '00000000-0000-4000-8000-000000000001';
      const { error } = await clientA
        .from('played_songs')
        .update({ event_id: nonexistentEventId })
        .eq('id', songs[0].id)
        .select();

      // 42501 is insufficient_privilege: RLS's WITH CHECK rejecting the new
      // row. Verified live and reproducibly -- see the comment above.
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
      // Disambiguates from a grant failure, which reads "permission denied for table" instead --
      // this message is RLS's own wording, confirmed live 2026-08-29.
      expect(error!.message).toMatch(/row-level security/);
    });

    // count(s.id) vs count(*): a completed event with no songs must read 0,
    // not 1. The seed creates exactly one such event.
    test('a completed event with no songs reads 0, not 1', async () => {
      const { data, error } = await clientA
        .from('past_events_with_counts')
        .select('couple_names, songs_played')
        .eq('couple_names', 'Ruth & Adam');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].songs_played).toBe(0);
    });

    // The other half of case 8, and the one that actually pins count(s.id).
    // The zero case below passes even if the view returns 0 for everything;
    // this one does not. 'Noa & Eitan' is seeded with exactly 10 songs.
    test('an event with songs reads its real count through the view', async () => {
      const { data, error } = await clientA
        .from('past_events_with_counts')
        .select('couple_names, songs_played')
        .eq('couple_names', 'Noa & Eitan');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].songs_played).toBe(10);
    });

    test('a cancelled event does not appear in the view', async () => {
      const { data, error } = await clientA
        .from('past_events_with_counts')
        .select('couple_names')
        .eq('couple_names', 'Lena & Mark');
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);
