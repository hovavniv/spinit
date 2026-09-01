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
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

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

    describe('event_must_play and event_blocklist', () => {
      let rowOfA: string;

      beforeAll(async () => {
        const { data, error } = await clientA
          .from('event_must_play')
          // spotify_track_id is required (plan B13: must_play_track_id_shape,
          // set not null) -- a plain shape-valid placeholder is enough here,
          // this suite tests RLS, not Spotify identity.
          .insert({
            event_id: anEventOfA,
            segment: 'party',
            title: 'Seeded by the RLS suite',
            spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa',
          })
          .select('id')
          .single();
        if (error || !data) throw new Error(`A could not insert a must-play: ${error?.message}`);
        rowOfA = data.id;
      });

      // This suite runs against the LIVE project, not a mock -- anything it
      // inserts and does not remove permanently litters the demo data. The
      // beforeAll row and the ceremony test's two rows below are the only
      // rows this describe block leaves behind if left uncleaned; the
      // blocklist test already cleans up after itself inline. Best-effort:
      // a cleanup failure here must not mask the real test results above,
      // so errors are logged, not thrown.
      afterAll(async () => {
        const { error: rowOfAError } = await clientA.from('event_must_play').delete().eq('id', rowOfA);
        if (rowOfAError) {
          console.warn(`afterAll cleanup: could not delete rowOfA (${rowOfA}): ${rowOfAError.message}`);
        }

        // anEventOfA is 'Noa & Eitan' (see the outer beforeAll), which the
        // seed script gives an empty mustPlay list -- it has no ceremony
        // rows of its own, unlike 'Priya & Alex', which really does use
        // these same two moment strings. Scoping by event_id + segment +
        // moment means this only ever deletes the rows this specific test
        // created, on this specific event.
        const { error: ceremonyError } = await clientA
          .from('event_must_play')
          .delete()
          .eq('event_id', anEventOfA)
          .eq('segment', 'ceremony')
          .in('moment', ['Walking down the aisle', 'Breaking the glass']);
        if (ceremonyError) {
          console.warn(`afterAll cleanup: could not delete ceremony rows: ${ceremonyError.message}`);
        }
      });

      test('B cannot see any of A rows', async () => {
        const { data, error } = await clientB.from('event_must_play').select('id');

        expect(error).toBeNull();
        expect(data?.some((row) => row.id === rowOfA)).toBe(false);
      });

      test('B cannot insert against A event', async () => {
        const { error } = await clientB.from('event_must_play').insert({
          event_id: anEventOfA,
          segment: 'party',
          title: 'Not mine',
          // Kept for shape-validity and consistency with the fixture above,
          // not because it changes the outcome: a fresh-context review
          // reproduced this schema and confirmed RLS's with-check is
          // evaluated BEFORE ExecConstraints, so 42501 fires regardless of
          // whether an id is present. An earlier version of this comment
          // claimed the opposite (that a missing id would raise 23502 first)
          // -- that claim was wrong and unverified; corrected here rather
          // than left to mislead the next reader.
          spotify_track_id: 'bbbbbbbbbbbbbbbbbbbbbb',
        });

        // insert is refused by `with check`, which RAISES.
        expect(error?.code).toBe('42501');
      });

      test('B deleting A row affects zero rows and raises nothing', async () => {
        // A delete policy has only `using`, which FILTERS — Postgres rejects
        // `for delete ... with check` outright. So the correct assertion is
        // "no error, nothing deleted", not "an error". The cross-tenant update
        // case above is pinned the same way.
        const { data, error } = await clientB
          .from('event_must_play')
          .delete()
          .eq('id', rowOfA)
          .select();

        expect(error).toBeNull();
        expect(data).toEqual([]);

        const stillThere = await clientA.from('event_must_play').select('id').eq('id', rowOfA);
        expect(stillThere.data).toHaveLength(1);
      });

      test('A can insert, read and delete their own blocklist entry', async () => {
        const inserted = await clientA
          .from('event_blocklist')
          .insert({
            event_id: anEventOfA,
            segment: 'party',
            entry_type: 'genre',
            value: `rls-suite-${Date.now()}`,
          })
          .select('id')
          .single();
        expect(inserted.error).toBeNull();

        const deleted = await clientA
          .from('event_blocklist')
          .delete()
          .eq('id', inserted.data!.id)
          .select();
        expect(deleted.error).toBeNull();
        expect(deleted.data).toHaveLength(1);
      });

      test('saving both ceremony slots twice leaves two rows, not four', async () => {
        // This is the test that catches a broken ceremony write. A mocked
        // client cannot: it returns whatever the double was told to return, so
        // it passes cleanly while the real statement fails. An earlier draft of
        // this design upserted against a PARTIAL unique index, which Postgres
        // refuses as an ON CONFLICT target (42P10) — the page's Save button
        // would have been permanently broken behind a generic error message.
        const slots = ['Walking down the aisle', 'Breaking the glass'];
        // spotify_track_id is required (plan B13). Distinct per moment, not
        // that it matters functionally here, but a shared id can't reveal a
        // slot being written to the wrong row the way a distinct one can.
        const trackIdForMoment: Record<string, string> = {
          'Walking down the aisle': 'cWalkingAisleTrackId01',
          'Breaking the glass': 'cBreakingGlassTrackId1',
        };

        for (let pass = 0; pass < 2; pass += 1) {
          for (const moment of slots) {
            const existing = await clientA
              .from('event_must_play')
              .select('id')
              .eq('event_id', anEventOfA)
              .eq('segment', 'ceremony')
              .eq('moment', moment)
              .maybeSingle();

            if (existing.data) {
              const { error } = await clientA
                .from('event_must_play')
                .update({ title: `pass ${pass}` })
                .eq('id', existing.data.id)
                .eq('event_id', anEventOfA)
                .eq('segment', 'ceremony');
              expect(error).toBeNull();
            } else {
              const { error } = await clientA.from('event_must_play').insert({
                event_id: anEventOfA,
                segment: 'ceremony',
                moment,
                title: `pass ${pass}`,
                spotify_track_id: trackIdForMoment[moment],
              });
              expect(error).toBeNull();
            }
          }
        }

        const { data } = await clientA
          .from('event_must_play')
          .select('id, moment')
          .eq('event_id', anEventOfA)
          .eq('segment', 'ceremony');

        expect(data).toHaveLength(2);
      });
    });

    // --- The queries getEventRecap issues (design §4, §10) -----------------

    test('A reads their own completed event through the recap filters', async () => {
      const { data, error } = await clientA
        .from('events')
        .select('id, couple_names, venue, event_date')
        .eq('id', anEventOfA)
        .eq('dj_id', userAId)
        .eq('status', 'completed')
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.couple_names).toBe('Noa & Eitan');
    });

    test('B reads zero rows through the same filters', async () => {
      const { data, error } = await clientB
        .from('events')
        .select('id')
        .eq('id', anEventOfA)
        .eq('status', 'completed')
        .maybeSingle();

      // maybeSingle() on zero rows is null data and no error, which is the
      // behaviour getEventRecap turns into notFound(). If this ever starts
      // erroring instead, the DAL's `if (eventError) throw` would turn a
      // wrong-owner request into a 500 and leak that the id exists.
      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    // The playlist query carries no dj_id predicate of its own. This is the
    // test that says it does not need one.
    test("A's playlist comes back ordered by position", async () => {
      const { data, error } = await clientA
        .from('played_songs')
        .select('position, title, artist, suggested_by')
        .eq('event_id', anEventOfA)
        .order('position', { ascending: true });

      expect(error).toBeNull();
      expect(data!.length).toBe(10);
      expect(data!.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      // The seed's first song for this event, so this pins the ORDER and not
      // merely that ten rows came back in some sequence.
      expect(data![0].title).toBe('At Last');
    });

    test('a cancelled event is unreachable through the recap filters, even by its owner', async () => {
      const { data: cancelled } = await clientA
        .from('events')
        .select('id')
        .eq('couple_names', 'Lena & Mark')
        .limit(1);

      if (!cancelled || cancelled.length === 0) {
        throw new Error("No 'Lena & Mark' event for user A. Run `npm run seed:demo` first.");
      }

      const { data, error } = await clientA
        .from('events')
        .select('id')
        .eq('id', cancelled[0].id)
        .eq('dj_id', userAId)
        .eq('status', 'completed')
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  },
);

/* ---------------------------------------------------------------------------
   PARTNER ACCESS — plan A task 11.

   SCAFFOLDING ONLY so far. The assertions are deliberately not written yet:
   the migration that creates event_partners and the two note tables is
   authored but UNREVIEWED and UNPUSHED, so every assertion here would be a
   claim about policy behaviour that has never run. They land once the
   migration review returns and the push is verified.

   This block therefore fails loudly until then, which is correct -- it must
   not go quietly green while testing nothing.

   User A is the DJ. User C is the partner. B stays what it already is: an
   unrelated second DJ, used as the "signed-in stranger" control.

   THE NEGATIVE CONTROL IS PER-EVENT, NOT PER-DJ. A owns two events and C
   claims a slot on only ONE of them. "C can read event 1 but not event 2,
   both owned by the same DJ" is a sharper claim than "an unrelated DJ sees
   nothing": it proves the partner link is scoped to the event rather than
   leaking across everything its DJ owns.
   --------------------------------------------------------------------------- */

const C_EMAIL = process.env.TEST_USER_C_EMAIL;
const C_PASSWORD = process.env.TEST_USER_C_PASSWORD;
const hasPartnerUser = Boolean(C_EMAIL && C_PASSWORD);

if (hasSupabaseConfig && hasTestUsers && !hasPartnerUser) {
  describe('partner access (auth-gated)', () => {
    test('TEST_USER_C_* must be set for the partner-role tests', () => {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL and TEST_USER_A/B are set but TEST_USER_C_EMAIL / ' +
          'TEST_USER_C_PASSWORD are not. The partner role needs its own account: ' +
          'claim_partner_slot matches the invitation against the CALLER\'S OWN verified ' +
          'account email, so the partner cannot be impersonated by reusing A or B.',
      );
    });
  });
}

describe.skipIf(!hasSupabaseConfig || !hasTestUsers || !hasPartnerUser)(
  'partner access (auth-gated)',
  { timeout: 30000 },
  () => {
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let clientC: SupabaseClient;
    let userCId: string;

    /** The event C claims a slot on. */
    let linkedEvent: string;
    /** Another event of the SAME DJ that C never claims. The negative control. */
    let unlinkedEvent: string;
    /** The partner row C claims, so afterAll can restore it to unclaimed. */
    let claimedPartnerId: string;
    let originalInviteEmail: string;

    beforeAll(async () => {
      // persistSession: false on EVERY client, for the reason the block above
      // records at length: supabase-js derives its storage key from the
      // project ref alone, so three clients would share one localStorage slot
      // under jsdom and each sign-in would overwrite the last. Every
      // "C cannot see this" assertion would then be running as whoever signed
      // in last and passing for entirely the wrong reason.
      clientA = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });
      clientB = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });
      clientC = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });

      const a = await clientA.auth.signInWithPassword({ email: A_EMAIL!, password: A_PASSWORD! });
      if (a.error) throw new Error(`sign in A failed: ${a.error.message}`);

      const b = await clientB.auth.signInWithPassword({ email: B_EMAIL!, password: B_PASSWORD! });
      if (b.error) throw new Error(`sign in B failed: ${b.error.message}`);

      const c = await clientC.auth.signInWithPassword({ email: C_EMAIL!, password: C_PASSWORD! });
      // An account created but never confirmed signs in with
      // `email_not_confirmed`, which reads nothing like an RLS defect. Say so.
      if (c.error || !c.data.user) {
        throw new Error(
          `sign in C failed: ${c.error?.message}. If this is email_not_confirmed, ` +
            'the account exists but was never confirmed -- the project mailer caps at ' +
            '2 emails/hour, so a confirmation may simply never have been sent.',
        );
      }
      userCId = c.data.user.id;

      // Two events of the SAME DJ. Named rather than "any two": the seed
      // creates six and picking arbitrarily makes a failure message depend on
      // whichever Postgres happened to return.
      const pick = async (coupleNames: string) => {
        const { data, error } = await clientA
          .from('events')
          .select('id')
          .eq('couple_names', coupleNames)
          .limit(1);
        if (error) throw new Error(`could not read A's events: ${error.message}`);
        if (!data || data.length === 0) {
          throw new Error(`No '${coupleNames}' event for user A. Run \`npm run seed:demo\`.`);
        }
        return data[0].id as string;
      };

      linkedEvent = await pick('Priya & Alex');
      unlinkedEvent = await pick('Noa & Eitan');

      // The seed writes both partner slots with @example.com invitations, so
      // point slot 1 of the linked event at C's real account email. A holds a
      // COLUMN-SCOPED update grant covering invite_email, which is exactly
      // what makes this legal -- and user_id is absent from that grant, which
      // is what stops us shortcutting the claim below.
      const { data: slot, error: slotError } = await clientA
        .from('event_partners')
        .select('id, invite_email, display_name')
        .eq('event_id', linkedEvent)
        .eq('slot', 1)
        .maybeSingle();
      if (slotError || !slot) {
        throw new Error(
          `No partner slot 1 on the linked event: ${slotError?.message ?? 'no row'}. ` +
            'Run `npm run seed:demo` after the migration.',
        );
      }
      originalInviteEmail = slot.invite_email;

      // Reset the slot to a KNOWN UNCLAIMED state rather than assuming it is
      // already one. user_id cannot be un-set through PostgREST -- that is the
      // point of the column grant -- so "unclaim" means delete and re-insert.
      //
      // Without this the suite depends on the state a previous run, a manual
      // walkthrough or a demo left behind: if anything already claimed this
      // slot, claim_partner_slot correctly refuses, beforeAll throws, and the
      // whole block fails for a reason that has nothing to do with the policies
      // it exists to test. It then SELF-HEALS on the next run because afterAll
      // restores the row -- a test that passes only every other time is worse
      // than one that fails honestly.
      await clientA.from('event_partners').delete().eq('id', slot.id);
      const { data: fresh, error: reinsertError } = await clientA
        .from('event_partners')
        .insert({
          event_id: linkedEvent,
          slot: 1,
          display_name: slot.display_name,
          invite_email: C_EMAIL!,
        })
        .select('id')
        .single();
      if (reinsertError || !fresh) {
        throw new Error(`could not reset the partner slot: ${reinsertError?.message}`);
      }
      claimedPartnerId = fresh.id;

      // The claim itself, through the function -- the ONLY path that writes
      // user_id, because no PostgREST role holds a grant on that column.
      const { error: claimError } = await clientC.rpc('claim_partner_slot', {
        p_event: linkedEvent,
        p_slot: 1,
      });
      if (claimError) throw new Error(`C could not claim its slot: ${claimError.message}`);
    });

    afterAll(async () => {
      // Every test cleans up the rows it writes. user_id cannot be un-set
      // through PostgREST at all -- that is the point of the grant -- so
      // restoring the slot to unclaimed means deleting the row and
      // re-inserting it. The delete cascades to spotify_connections,
      // spotify_tokens and taste_profiles, which is what we want: a re-claimed
      // slot must start clean.
      //
      // Wrapped so a cleanup failure cannot THROW and mask the real reason a
      // test failed. `claimedPartnerId` is captured before the invitation is
      // rewritten, so this still restores the row if beforeAll threw partway
      // through -- which is the case that would otherwise leave the seeded
      // slot pointing at a real account email.
      if (!claimedPartnerId) return;

      try {
        await clientA.from('event_partners').delete().eq('id', claimedPartnerId);
        await clientA.from('event_partners').insert({
          event_id: linkedEvent,
          slot: 1,
          display_name: 'Priya',
          invite_email: originalInviteEmail,
        });
        // Leave the shared note as the seed had it.
        await clientA
          .from('event_shared_notes')
          .upsert({ event_id: linkedEvent, body: '' }, { onConflict: 'event_id' });
      } catch (cleanupError) {
        console.error('partner access: cleanup failed, live rows may be left behind', cleanupError);
      }
    });

    test('the fixture linked C to exactly one of the two events', async () => {
      // A smoke test for the scaffolding, not a security assertion. If the
      // claim silently did nothing, every later "C can read this" test would
      // fail in a way that looks like a policy bug.
      const { data, error } = await clientC
        .from('event_partners')
        .select('id, event_id, user_id')
        .eq('id', claimedPartnerId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.user_id).toBe(userCId);
      expect(data!.event_id).toBe(linkedEvent);
    });

    /* --- what a partner MAY do ------------------------------------------ */

    test('a partner reads the event they are linked to', async () => {
      const { data } = await clientC.from('events').select('id').eq('id', linkedEvent);
      expect(data).toHaveLength(1);
    });

    // THE NEGATIVE CONTROL, and deliberately against the SAME DJ's other
    // event rather than a stranger's. "C cannot read B's event" would pass
    // even if the link leaked across everything A owns; this cannot.
    test('a partner cannot read another event of the SAME dj', async () => {
      const { data } = await clientC.from('events').select('id').eq('id', unlinkedEvent);
      expect(data ?? []).toHaveLength(0);
    });

    test('an unrelated signed-in dj still sees neither event', async () => {
      const { data: one } = await clientB.from('events').select('id').eq('id', linkedEvent);
      const { data: two } = await clientB.from('events').select('id').eq('id', unlinkedEvent);
      expect(one ?? []).toHaveLength(0);
      expect(two ?? []).toHaveLength(0);
    });

    test('a partner can add and remove song-list rows', async () => {
      const ins = await clientC
        .from('event_blocklist')
        .insert({ event_id: linkedEvent, segment: 'party', entry_type: 'genre', value: 'polka' })
        .select();
      expect(ins.error).toBeNull();
      expect(ins.data).toHaveLength(1);

      const del = await clientC
        .from('event_blocklist')
        .delete()
        .eq('id', ins.data![0].id)
        .select();
      expect(del.data).toHaveLength(1);
    });

    test('a partner cannot read private notes but can read and write shared notes', async () => {
      const priv = await clientC
        .from('event_private_notes')
        .select('body')
        .eq('event_id', linkedEvent);
      expect(priv.data ?? []).toHaveLength(0);

      const shared = await clientC
        .from('event_shared_notes')
        .upsert({ event_id: linkedEvent, body: 'from the couple' }, { onConflict: 'event_id' })
        .select();
      expect(shared.error).toBeNull();
      expect(shared.data).toHaveLength(1);
    });

    /* --- what a partner MAY NOT do -------------------------------------- */

    test('a partner cannot cancel the event', async () => {
      // events UPDATE was deliberately NOT widened: reading widens, writing
      // does not. A partner editing song lists must not be able to cancel a
      // wedding.
      const { data } = await clientC
        .from('events')
        .update({ status: 'cancelled' })
        .eq('id', linkedEvent)
        .select();
      expect(data ?? []).toHaveLength(0);
    });

    test('a partner cannot read the other partner\'s spotify token', async () => {
      const { data } = await clientC.from('spotify_tokens').select('partner_id');
      expect(data ?? []).toHaveLength(0);
    });

    /* --- the anti-regression set ----------------------------------------
       Each control is asserted as a CAPABILITY, not as one verb. Three
       consecutive reviews found the same shape: a correct fix, a test
       pinning only the case already found, and the hole intact one surface
       over. Do not split these "for clarity" -- splitting them is exactly
       how one gets fixed and the other does not.
       -------------------------------------------------------------------- */

    test('user_id cannot be forged: not by PATCH on an unclaimed row, not by the dj, not on INSERT', async () => {
      // 1. a signed-in user PATCHing any unclaimed slot
      const patchUnclaimed = await clientC
        .from('event_partners')
        .update({ user_id: userCId })
        .is('user_id', null)
        .select();
      expect(patchUnclaimed.data ?? []).toHaveLength(0);

      // 2. the DJ PATCHing user_id on their OWN event's row -- the hole the
      //    column-scoped UPDATE grant exists to close
      const patchAsDj = await clientA
        .from('event_partners')
        .update({ user_id: userCId })
        .eq('id', claimedPartnerId)
        .select();
      expect(patchAsDj.data ?? []).toHaveLength(0);

      // 3. the DJ POSTing a row with an explicit user_id -- the adjacent verb
      //    review 3 found still open after review 2's fix
      const insertWithUserId = await clientA.from('event_partners').insert({
        event_id: linkedEvent,
        slot: 2,
        display_name: 'forged',
        invite_email: 'x@example.com',
        user_id: userCId,
      });
      expect(insertWithUserId.error?.code).toBe('42501');
    });

    test('a participant writes artist_genres for their own event; a non-participant is refused', async () => {
      // 20260901090000_spotify_genre_enrichment.sql rescoped artist_genres per
      // event and dropped upsert_artist_genres entirely (it no longer exists,
      // verified against 20260831140000_spotify_song_id_columns.sql:71-73,
      // which drops it). The old form of this test asserted a direct table
      // write was refused and an RPC call errored -- both now prove the wrong
      // thing: a participant CAN insert directly (that is the point of the
      // rescope), and the RPC call errors only because the function does not
      // exist (42883), which says nothing about authorization.
      //
      // clientC is a partner of linkedEvent; clientB is signed in as an
      // entirely different DJ, a participant of neither linkedEvent nor
      // unlinkedEvent (both of which belong to clientA) -- the same
      // "unrelated signed-in dj" this block already uses as its negative
      // control above.
      //
      // The migration grants this table only select/insert/update, not
      // delete, so this test cannot clean up its own rows -- a fixed id would
      // collide with itself on the second run (23505) and silently fail to
      // prove anything. Per-run random ids (still 22 chars, matching the
      // spotify_artist_id shape check) leave harmless debris in the live
      // per-event cache instead of a false pass. Two distinct ids: reusing
      // one for both inserts would make the second fail on the pkey (23505)
      // rather than on the RLS refusal (42501) this test is actually proving.
      const randomArtistId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 22);

      const ownWrite = await clientC
        .from('artist_genres')
        .insert({
          event_id: linkedEvent,
          spotify_artist_id: randomArtistId(),
          artist_name: 'x',
        })
        .select();
      expect(ownWrite.error).toBeNull();
      expect(ownWrite.data).toHaveLength(1);

      const foreignWrite = await clientB.from('artist_genres').insert({
        event_id: linkedEvent,
        spotify_artist_id: randomArtistId(),
        artist_name: 'x',
      });
      expect(foreignWrite.error?.code).toBe('42501');
    });

    test('claim_partner_slot refuses a caller who was not invited, and says nothing', async () => {
      // B is signed in and the slot is unclaimed, but the invitation is not
      // addressed to B. 42501 for every failure mode, so the caller cannot
      // tell "no such event" from "already claimed" from "not yours".
      const { error } = await clientB.rpc('claim_partner_slot', {
        p_event: linkedEvent,
        p_slot: 2,
      });
      expect(error).toBeTruthy();
      expect(error!.code).toBe('42501');
    });

    test('a partner cannot re-parent a song-list row onto an event they do not participate in', async () => {
      const ins = await clientC
        .from('event_blocklist')
        .insert({ event_id: linkedEvent, segment: 'party', entry_type: 'genre', value: 'ska' })
        .select();
      expect(ins.data).toHaveLength(1);

      // The same predicate sits in BOTH `using` and `with check`, which is
      // what stops the row moving to an event the writer is not on.
      const moved = await clientC
        .from('event_blocklist')
        .update({ event_id: unlinkedEvent })
        .eq('id', ins.data![0].id)
        .select();
      expect(moved.data ?? []).toHaveLength(0);

      await clientC.from('event_blocklist').delete().eq('id', ins.data![0].id);
    });

    /* --- the dj is not locked out by any of this ------------------------ */

    test('the dj still reads their own private notes', async () => {
      const { data } = await clientA
        .from('event_private_notes')
        .select('body')
        .eq('event_id', linkedEvent);
      expect(data).toHaveLength(1);
    });

    test('writing notes on an event that had none persists -- the upsert path', async () => {
      // An update against a missing row returns success having written
      // nothing. The migration backfills a row per event so this works today;
      // the upsert is what keeps it working for an event created later.
      const target = unlinkedEvent;
      const write = await clientA
        .from('event_private_notes')
        .upsert({ event_id: target, body: 'written later' }, { onConflict: 'event_id' })
        .select();
      expect(write.error).toBeNull();

      const { data } = await clientA
        .from('event_private_notes')
        .select('body')
        .eq('event_id', target);
      expect(data?.[0]?.body).toBe('written later');

      await clientA
        .from('event_private_notes')
        .upsert({ event_id: target, body: '' }, { onConflict: 'event_id' });
    });
  },
);

/* ---------------------------------------------------------------------------
   SPOTIFY TABLES — plan B task 13.

   spotify_connections, spotify_tokens and taste_profiles have been live and
   empty since the migration shipped. This is the first test of the exact
   boundary those three tables exist to protect: one partner must not be able
   to read or write another partner's Spotify credentials.

   A and B are DJs (unrelated to each other), C is already a partner used
   elsewhere in this file. The assertions here need TWO partners of the SAME
   event who are genuinely different people -- reusing A/B/C would test
   cross-DJ or cross-event isolation, not the partner-vs-partner boundary
   these tables specifically need. Hence a FOURTH account, D.
   --------------------------------------------------------------------------- */

const D_EMAIL = process.env.TEST_USER_D_EMAIL;
const D_PASSWORD = process.env.TEST_USER_D_PASSWORD;
const hasFourthTestUser = Boolean(D_EMAIL && D_PASSWORD);

if (hasSupabaseConfig && hasTestUsers && hasPartnerUser && !hasFourthTestUser) {
  describe('spotify tables (auth-gated)', () => {
    test('TEST_USER_D_* must be set for the spotify-tables tests', () => {
      throw new Error(
        'TEST_USER_A/B/C are set but TEST_USER_D_EMAIL / TEST_USER_D_PASSWORD are not. ' +
          'These tests need a SECOND partner on the same event as C -- reusing A, B or C ' +
          'would test cross-DJ or cross-event isolation, not the partner-vs-partner ' +
          'boundary spotify_tokens exists to enforce. Create the account through the ' +
          'Supabase dashboard with Auto Confirm ON, not through /register.',
      );
    });
  });
}

describe.skipIf(!hasSupabaseConfig || !hasTestUsers || !hasPartnerUser || !hasFourthTestUser)(
  'spotify tables (auth-gated)',
  { timeout: 30000 },
  () => {
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let clientC: SupabaseClient;
    let clientD: SupabaseClient;

    let linkedEvent: string;
    let unlinkedEvent: string;
    let partnerC: string;
    let partnerD: string;
    let partnerOnEventB: string;

    let slot1Original: { invite_email: string; display_name: string };
    let slot2Original: { invite_email: string; display_name: string };
    let unlinkedSlot1Original: { invite_email: string; display_name: string };

    // Every seeding write below goes through this rather than a bare
    // `.upsert(...)` -- an unchecked upsert can silently write zero rows
    // (wrong column, RLS misconfiguration, etc.) and the suite would stay
    // green while the row it claims to have seeded never existed.
    const seed = async (client: SupabaseClient, table: string, row: Record<string, unknown>) => {
      const { data, error } = await client
        .from(table)
        .upsert(row, { onConflict: 'partner_id' })
        .select();
      if (error || !data?.length) {
        throw new Error(`seeding ${table} for ${row.partner_id} failed: ${error?.message ?? 'zero rows'}`);
      }
    };

    beforeAll(async () => {
      // persistSession: false on EVERY client -- same reason as the two
      // describe blocks above: supabase-js keys localStorage by project ref
      // alone under jsdom, so four clients would otherwise share one slot.
      clientA = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      clientB = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      clientC = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      clientD = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

      const a = await clientA.auth.signInWithPassword({ email: A_EMAIL!, password: A_PASSWORD! });
      if (a.error) throw new Error(`sign in A failed: ${a.error.message}`);
      const b = await clientB.auth.signInWithPassword({ email: B_EMAIL!, password: B_PASSWORD! });
      if (b.error) throw new Error(`sign in B failed: ${b.error.message}`);
      const c = await clientC.auth.signInWithPassword({ email: C_EMAIL!, password: C_PASSWORD! });
      if (c.error) throw new Error(`sign in C failed: ${c.error.message}`);
      const d = await clientD.auth.signInWithPassword({ email: D_EMAIL!, password: D_PASSWORD! });
      if (d.error || !d.data.user) {
        throw new Error(
          `sign in D failed: ${d.error?.message}. If this is email_not_confirmed, the ` +
            'dashboard account was created without Auto Confirm.',
        );
      }

      const pick = async (coupleNames: string) => {
        const { data, error } = await clientA
          .from('events')
          .select('id')
          .eq('couple_names', coupleNames)
          .limit(1);
        if (error || !data?.length) {
          throw new Error(`No '${coupleNames}' event for A. Run \`npm run seed:demo\`.`);
        }
        return data[0].id as string;
      };
      linkedEvent = await pick('Priya & Alex');
      unlinkedEvent = await pick('Noa & Eitan');

      const repointAndClaim = async (
        client: SupabaseClient,
        eventId: string,
        slot: 1 | 2,
        email: string,
      ) => {
        const { data: seeded } = await clientA
          .from('event_partners')
          .select('id, invite_email, display_name')
          .eq('event_id', eventId)
          .eq('slot', slot)
          .maybeSingle();
        if (!seeded) throw new Error(`No partner slot ${slot} on event ${eventId}.`);
        const original = { invite_email: seeded.invite_email, display_name: seeded.display_name };
        await clientA.from('event_partners').delete().eq('id', seeded.id);
        const { data: fresh, error: insertError } = await clientA
          .from('event_partners')
          .insert({ event_id: eventId, slot, display_name: seeded.display_name, invite_email: email })
          .select('id')
          .single();
        if (insertError || !fresh) throw new Error(`could not reset slot ${slot}: ${insertError?.message}`);
        const claim = await client.rpc('claim_partner_slot', { p_event: eventId, p_slot: slot });
        if (claim.error) throw new Error(`claim failed for slot ${slot}: ${claim.error.message}`);
        return { partnerId: fresh.id as string, original };
      };

      ({ partnerId: partnerC, original: slot1Original } = await repointAndClaim(
        clientC,
        linkedEvent,
        1,
        C_EMAIL!,
      ));
      ({ partnerId: partnerD, original: slot2Original } = await repointAndClaim(
        clientD,
        linkedEvent,
        2,
        D_EMAIL!,
      ));
      ({ partnerId: partnerOnEventB, original: unlinkedSlot1Original } = await repointAndClaim(
        clientB,
        unlinkedEvent,
        1,
        B_EMAIL!,
      ));

      await seed(clientC, 'spotify_connections', {
        partner_id: partnerC,
        status: 'connected',
        spotify_user_id: 'spotify-c',
      });
      await seed(clientC, 'spotify_tokens', {
        partner_id: partnerC,
        refresh_token: 'v1.aaaa.bbbb.token-c',
      });
      await seed(clientC, 'taste_profiles', {
        partner_id: partnerC,
        top_artists: [{ id: 'artist-c', name: 'Artist C', score: 1, ranges: [] }],
      });

      await seed(clientD, 'spotify_connections', {
        partner_id: partnerD,
        status: 'connected',
        spotify_user_id: 'spotify-d',
      });
      await seed(clientD, 'spotify_tokens', {
        partner_id: partnerD,
        refresh_token: 'v1.cccc.dddd.token-d',
      });
      await seed(clientD, 'taste_profiles', {
        partner_id: partnerD,
        top_artists: [{ id: 'artist-d', name: 'Artist D', score: 1, ranges: [] }],
      });

      // Positive control for "a partner of event A reads no taste profile
      // from event B" below -- without a seeded row here, that test's
      // toHaveLength(0) is equally true because the row simply doesn't
      // exist, and would pass with RLS disabled entirely.
      await seed(clientB, 'taste_profiles', {
        partner_id: partnerOnEventB,
        top_artists: [{ id: 'artist-b', name: 'Artist B', score: 1, ranges: [] }],
      });
    });

    afterAll(async () => {
      // Unclaiming (delete + reinsert) CASCADES to spotify_connections,
      // spotify_tokens and taste_profiles -- partner_id is `on delete cascade`
      // on all three -- so the rows seeded above need no separate teardown.
      try {
        if (partnerC) {
          await clientA.from('event_partners').delete().eq('id', partnerC);
          await clientA
            .from('event_partners')
            .insert({ event_id: linkedEvent, slot: 1, ...slot1Original });
        }
        if (partnerD) {
          await clientA.from('event_partners').delete().eq('id', partnerD);
          await clientA
            .from('event_partners')
            .insert({ event_id: linkedEvent, slot: 2, ...slot2Original });
        }
        if (partnerOnEventB) {
          await clientA.from('event_partners').delete().eq('id', partnerOnEventB);
          await clientA
            .from('event_partners')
            .insert({ event_id: unlinkedEvent, slot: 1, ...unlinkedSlot1Original });
        }
      } catch (cleanupError) {
        console.error('spotify tables: cleanup failed, live rows may be left behind', cleanupError);
      }
    });

    test('a partner reads their own token row', async () => {
      const { data } = await clientC.from('spotify_tokens').select('partner_id').eq('partner_id', partnerC);
      expect(data).toHaveLength(1);
    });

    test('the OTHER partner cannot read it — zero rows, not an error', async () => {
      const { data, error } = await clientD
        .from('spotify_tokens')
        .select('partner_id')
        .eq('partner_id', partnerC);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    test('the DJ cannot read it either', async () => {
      const { data } = await clientA.from('spotify_tokens').select('partner_id').eq('partner_id', partnerC);
      expect(data ?? []).toHaveLength(0);
    });

    test("a partner writes their OWN token, and cannot write another partner's", async () => {
      // Positive control FIRST. Without it, "zero rows" below would be
      // equally true of a row that simply does not exist -- an UPDATE
      // against a missing row also returns success with zero rows, no
      // error. Self-contained rather than leaning on the earlier
      // "reads their own token row" test to have proven this row exists.
      const mine = await clientC
        .from('spotify_tokens')
        .update({ refresh_token: 'v1.own.update.token-c' })
        .eq('partner_id', partnerC)
        .select();
      expect(mine.error).toBeNull();
      expect(mine.data ?? []).toHaveLength(1);

      const theirs = await clientD
        .from('spotify_tokens')
        .update({ refresh_token: 'v1.x.y.z' })
        .eq('partner_id', partnerC)
        .select();
      expect(theirs.error).toBeNull();
      expect(theirs.data ?? []).toHaveLength(0);
    });

    test("a partner writes their OWN connection, and cannot write another partner's", async () => {
      // Same positive-control shape as the token test above: prove the row
      // exists and is writable by its owner before the zero-row assertion
      // below can mean "RLS blocked it" rather than "there was no row".
      const mine = await clientC
        .from('spotify_connections')
        .update({ status: 'connected' })
        .eq('partner_id', partnerC)
        .select();
      expect(mine.error).toBeNull();
      expect(mine.data ?? []).toHaveLength(1);

      const theirs = await clientD
        .from('spotify_connections')
        .update({ status: 'failed' })
        .eq('partner_id', partnerC)
        .select();
      expect(theirs.error).toBeNull();
      expect(theirs.data ?? []).toHaveLength(0);
    });

    test("a partner writes their OWN taste profile, and cannot write another partner's", async () => {
      const mine = await clientC
        .from('taste_profiles')
        .update({ top_artists: [{ id: 'artist-c', name: 'Artist C', score: 1, ranges: [] }] })
        .eq('partner_id', partnerC)
        .select();
      expect(mine.error).toBeNull();
      expect(mine.data ?? []).toHaveLength(1);

      const theirs = await clientD
        .from('taste_profiles')
        .update({ top_artists: [] })
        .eq('partner_id', partnerC)
        .select();
      expect(theirs.error).toBeNull();
      expect(theirs.data ?? []).toHaveLength(0);
    });

    test("the DJ reads BOTH partners' taste profiles for their own event", async () => {
      const { data } = await clientA
        .from('taste_profiles')
        .select('partner_id')
        .in('partner_id', [partnerC, partnerD]);
      expect(data?.map((r) => r.partner_id).sort()).toEqual([partnerC, partnerD].sort());
    });

    test('the DJ reads both connections but never a token', async () => {
      const conns = await clientA
        .from('spotify_connections')
        .select('partner_id')
        .in('partner_id', [partnerC, partnerD]);
      expect(conns.data).toHaveLength(2);
      const toks = await clientA
        .from('spotify_tokens')
        .select('partner_id')
        .in('partner_id', [partnerC, partnerD]);
      expect(toks.data ?? []).toHaveLength(0);
    });

    test('a partner of event A reads no taste profile from event B', async () => {
      // Positive control first: prove the row exists and its own owner can
      // see it, so the zero-row assertion below can only mean "RLS blocked
      // it" rather than "there was no row to find".
      const control = await clientB
        .from('taste_profiles')
        .select('partner_id')
        .eq('partner_id', partnerOnEventB);
      expect(control.data).toHaveLength(1);

      const { data, error } = await clientC
        .from('taste_profiles')
        .select('partner_id')
        .eq('partner_id', partnerOnEventB);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });
  },
);
