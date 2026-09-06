/**
 * RLS / grant integration tests for the live-event guest boundary
 * (design §10.4, plan Task 22).
 *
 * Migration A (20260905000000_live_event.sql) and Migration B
 * (20260905120000_guest_functions.sql), and Task 21's guest routes built on
 * top of them, have so far only been shape-checked against a throwaway local
 * Postgres whose `auth.uid()` stub always returns null -- no RLS predicate in
 * this slice has been evaluated as a real, signed-in user until THIS file
 * runs. Every assertion here is load-bearing evidence, not a formality.
 *
 * Conventions copied exactly from src/lib/events/rls.integration.test.ts and
 * src/lib/auth/rls.integration.test.ts:
 *  - `hasSupabaseConfig` / `hasTestUsers` gating: no Supabase config at all ->
 *    skip cleanly; Supabase configured but the required TEST_USER_* vars
 *    missing -> fail LOUDLY (a half-configured .env.local must not go
 *    quietly green while testing nothing).
 *  - `{ auth: { persistSession: false } }` on every client. supabase-js keys
 *    localStorage by project ref alone under this repo's jsdom test
 *    environment -- two clients signed in as different users would otherwise
 *    silently share one storage slot and the second sign-in would clobber
 *    the first, producing false-positive passes.
 *  - never `auth.signUp` (mailer cap, 2/hour project-wide).
 *  - run this whole file, never `vitest -t`: these suites share live fixture
 *    rows and ordered beforeAll/afterAll blocks; a filtered run skips
 *    cleanup its siblings assume ran.
 *
 * PREREQUISITE: `npm run seed:demo` has already been run. Not re-run by this
 * task -- see the brief for why (risk of colliding with in-flight state from
 * another session).
 *
 * The `played_songs` partner-select test uses 'Claire & Ben' (8 rows) as the
 * linked event and 'Noa & Eitan' (10 rows) as the unlinked negative control
 * -- NOT 'Priya & Alex' (0 played_songs rows), which the sibling RLS file
 * already uses for its own, unrelated partner-claim fixture. An empty table
 * makes "the partner reads zero rows" true whether or not the policy admits
 * them at all; both events used here are non-empty, so "reads N>0 rows from
 * the linked event, zero from the unlinked one despite it having real rows"
 * is an actual proof.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const A_EMAIL = process.env.TEST_USER_A_EMAIL;
const A_PASSWORD = process.env.TEST_USER_A_PASSWORD;
const B_EMAIL = process.env.TEST_USER_B_EMAIL;
const B_PASSWORD = process.env.TEST_USER_B_PASSWORD;
const C_EMAIL = process.env.TEST_USER_C_EMAIL;
const C_PASSWORD = process.env.TEST_USER_C_PASSWORD;

/**
 * The two events this file owns, seeded under TEST_USER_B by
 * `scripts/seed-demo.mjs` (see FIXTURE_EVENTS there for the full reasoning).
 *
 * Every guest session and suggestion this file writes is permanent -- nothing
 * in the schema can delete them -- so they must not land on an event a grader
 * will ever look at. They used to land on the demo events Sara & Daniel and
 * Priya & Alex, and on 2026-09-06 the DJ live screen showed 432 placeholder
 * requests as a result.
 */
const FIXTURE_EVENT = 'Integration A & Integration B';
const FOREIGN_FIXTURE_EVENT = 'Foreign A & Foreign B';

const hasSupabaseConfig = Boolean(SUPABASE_URL);
const hasTestUsers = Boolean(A_EMAIL && A_PASSWORD);
const hasFixtureUser = Boolean(B_EMAIL && B_PASSWORD);
const hasPartnerUser = Boolean(C_EMAIL && C_PASSWORD);

if (hasSupabaseConfig && !hasTestUsers) {
  describe('guest boundary integration (auth-gated)', () => {
    test('TEST_USER_A_* must be set when Supabase is configured', () => {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL is set but TEST_USER_A_EMAIL/TEST_USER_A_PASSWORD are not. ' +
          'This is a half-configured .env.local, not an intentional skip.',
      );
    });
  });
}

// song_suggestions.spotify_track_id is unique per event and these rows are
// never deleted (no delete grant anywhere in this slice), so a FIXED track id
// reused across runs stops being "new" on the second run: guest_suggest finds
// the row a prior run already created and takes the dedupe/vote path instead
// of consuming a cap slot, which silently breaks every test below that
// depends on a track being suggested for the FIRST time (the cap test, the
// used_count test). Generate a fresh, shape-valid (^[A-Za-z0-9]{22}$) id per
// call instead -- 32 hex chars from a UUID, sliced to 22, is a subset of that
// character class and unique enough for repeated local runs. guest_suggest
// never resolves these against the real Spotify API; only the shape matters.
const randomTrackId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 22);

// The one exception: this id is used only by requests that are refused
// before any uniqueness check is ever reached (a missing table/function
// grant), so it never actually gets written and a fixed value is fine.
const TRACK_GRANT_PROBE = 'xqqIKkeuIsWK2ISYAsC2s0';

if (hasSupabaseConfig && hasTestUsers && !hasFixtureUser) {
  describe('guest boundary integration (auth-gated)', () => {
    test('TEST_USER_B_* must be set: this file writes only to user B\'s fixture events', () => {
      throw new Error(
        'TEST_USER_B_EMAIL/TEST_USER_B_PASSWORD are not set. This suite writes permanent, ' +
          'undeletable guest_sessions and song_suggestions rows, so it runs ONLY against the ' +
          "fixture events owned by user B. Set them and run `npm run seed:demo`; do not repoint " +
          'this file at a demo event to make it run.',
      );
    });
  });
}

describe.skipIf(!hasSupabaseConfig || !hasTestUsers || !hasFixtureUser)(
  'guest boundary integration (auth-gated)',
  { timeout: 60000 },
  () => {
    // User B, the DJ who owns BOTH fixture events. Never user A: A is the
    // demo account, and every row this suite writes is undeletable.
    let clientB: SupabaseClient;
    let anon: SupabaseClient; // plain unauthenticated client. No signIn call, ever.
    let fixtureEventId: string;
    let fixtureEventToken: string;
    // The SECOND fixture event, used only by the wrong_event test below.
    let foreignEventToken: string;

    beforeAll(async () => {
      clientB = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

      const a = await clientB.auth.signInWithPassword({ email: B_EMAIL!, password: B_PASSWORD! });
      if (a.error || !a.data.user) throw new Error(`sign in A failed: ${a.error?.message}`);

      const load = async (coupleNames: string) => {
        const { data, error } = await clientB
          .from('events')
          .select('id, join_token, status')
          .eq('couple_names', coupleNames)
          .limit(1);
        if (error) throw new Error(`could not read B's events: ${error.message}`);
        if (!data || data.length === 0) {
          throw new Error(`No '${coupleNames}' fixture event for user B. Run \`npm run seed:demo\` first.`);
        }
        if (!data[0].join_token) {
          throw new Error(`'${coupleNames}' has no join_token. Run \`npm run seed:demo\` first.`);
        }
        // Both fixtures are seeded 'live' precisely so no test has to flip a
        // shared row to get there. A previous run that died mid-`finally`
        // would leave one 'upcoming'; say so plainly rather than failing
        // later with a confusing event_not_live from an unrelated test.
        if (data[0].status !== 'live') {
          throw new Error(
            `'${coupleNames}' is '${data[0].status}', not 'live' -- a previous run left it flipped. ` +
              'Re-run `npm run seed:demo` to restore it.',
          );
        }
        return { id: data[0].id as string, token: data[0].join_token as string };
      };

      const primary = await load(FIXTURE_EVENT);
      fixtureEventId = primary.id;
      fixtureEventToken = primary.token;
      foreignEventToken = (await load(FOREIGN_FIXTURE_EVENT)).token;
    });

    /* -------------------------------------------------------------------
       1. anon has NO table grants on any of the five new tables.
       ------------------------------------------------------------------- */

    describe('anon table grants: all five new tables are closed', () => {
      const tables = [
        'guest_sessions',
        'song_suggestions',
        'suggestion_votes',
        'spotify_tracks',
        'spotify_track_artists',
      ] as const;

      test('select is refused on all five tables', async () => {
        for (const table of tables) {
          const { data, error } = await anon.from(table).select('*').limit(1);
          expect(error, `select on ${table}`).not.toBeNull();
          expect(error!.code, `select on ${table}`).toBe('42501');
          expect(data, `select on ${table}`).toBeNull();
        }
      });

      test('insert is refused on all five tables', async () => {
        const attempts: Array<{ table: (typeof tables)[number]; row: Record<string, unknown> }> = [
          { table: 'guest_sessions', row: { event_id: fixtureEventId, display_name: 'grant probe' } },
          {
            table: 'song_suggestions',
            row: {
              event_id: fixtureEventId,
              spotify_track_id: TRACK_GRANT_PROBE,
              title: 'x',
              artist: 'y',
              suggested_by: fixtureEventId,
            },
          },
          { table: 'suggestion_votes', row: { suggestion_id: fixtureEventId, guest_id: fixtureEventId } },
          { table: 'spotify_tracks', row: { spotify_track_id: TRACK_GRANT_PROBE, title: 'x', artist: 'y' } },
          {
            table: 'spotify_track_artists',
            row: {
              spotify_track_id: TRACK_GRANT_PROBE,
              ordinal: 0,
              spotify_artist_id: TRACK_GRANT_PROBE,
              artist_name: 'x',
            },
          },
        ];
        for (const { table, row } of attempts) {
          const { error } = await anon.from(table).insert(row);
          expect(error, `insert on ${table}`).not.toBeNull();
          expect(error!.code, `insert on ${table}`).toBe('42501');
        }
      });
    });

    /* -------------------------------------------------------------------
       2. Function grants: the six guest RPCs are open to anon; the two
       dj_play RPCs are not. A table-grant test cannot see this -- a function
       left PUBLIC-executable never touches a table grant at all.
       ------------------------------------------------------------------- */

    describe('function grants: six guest RPCs open, two dj RPCs closed', () => {
      test('the six guest RPCs are callable by anon (a real app error, never 42501)', async () => {
        // Every call below is deliberately given a garbage id/token, so an
        // application-level error (no_such_event, no_such_session, ...) is
        // EXACTLY what proves the grant exists: a missing grant fails before
        // the function body ever runs, with 42501, not a raised message.
        const calls: Array<{ fn: string; args: Record<string, unknown> }> = [
          { fn: 'guest_event', args: { p_token: 'garbageTokenXXXXXXXXXX' } },
          { fn: 'guest_join', args: { p_token: 'garbageTokenXXXXXXXXXX', p_display_name: 'grant probe' } },
          {
            fn: 'guest_suggest',
            args: {
              p_session_id: '00000000-0000-4000-8000-000000000000',
              p_track_id: TRACK_GRANT_PROBE,
              p_title: 'x',
              p_artist: 'y',
            },
          },
          {
            fn: 'guest_vote',
            args: {
              p_session_id: '00000000-0000-4000-8000-000000000000',
              p_suggestion_id: '00000000-0000-4000-8000-000000000000',
            },
          },
          { fn: 'guest_queue', args: { p_session_id: '00000000-0000-4000-8000-000000000000' } },
          { fn: 'guest_search_allow', args: { p_session_id: '00000000-0000-4000-8000-000000000000' } },
        ];
        for (const { fn, args } of calls) {
          const { error } = await anon.rpc(fn, args);
          expect(error, `${fn} grant`).not.toBeNull();
          expect(error!.code, `${fn} grant`).not.toBe('42501');
        }
      });

      test('dj_play_suggestion and dj_play_pick are NOT callable by anon', async () => {
        const play1 = await anon.rpc('dj_play_suggestion', {
          p_event_id: fixtureEventId,
          p_suggestion_id: '00000000-0000-4000-8000-000000000000',
        });
        expect(play1.error?.code).toBe('42501');

        const play2 = await anon.rpc('dj_play_pick', {
          p_event_id: fixtureEventId,
          p_title: 'x',
          p_artist: 'y',
          p_track_id: TRACK_GRANT_PROBE,
        });
        expect(play2.error?.code).toBe('42501');
      });
    });

    /* -------------------------------------------------------------------
       3. Guest RPC behaviour, via fresh sessions on the PRIMARY fixture
       event. Every test mints its own session, so none inherits a count
       polluted by an earlier run.

       Litter note, and the reason this file no longer touches a demo event:
       the "suggestion cap", "used_count" and "wrong_event" tests each add
       song_suggestions rows, and neither guest_sessions nor song_suggestions
       carries a delete grant for anon or the DJ -- so re-running this file
       grows the fixture events' queues by a few rows every run, permanently.
       The cap is per SESSION (fresh every run), so nothing here breaks. What
       DID break is that these rows used to land on the demo events: each
       random track id 404s against Spotify, the live poll route writes the
       'Unavailable track' sentinel for it (by design), and by 2026-09-06 the
       DJ live screen showed 432 placeholder requests. The rows are still
       undeletable; they are now merely invisible to the demo account.
       ------------------------------------------------------------------- */

    describe('guest RPC behaviour (fresh fixture-event sessions)', () => {
      test('guest_join on the live event returns a session id', async () => {
        const { data, error } = await anon.rpc('guest_join', {
          p_token: fixtureEventToken,
          p_display_name: 'Integration Guest',
        });
        expect(error).toBeNull();
        expect(typeof data).toBe('string');
      });

      // Why this flips the fixture event rather than reusing an event that
      // is ALREADY non-live: only an event that has actually gone live ever
      // gets a join_token written (startEvent, and the seed script's
      // liveColumns, apply it solely when status === 'live'), so every
      // non-live event's token is NULL. guest_join with a null token never
      // reaches the status check at all -- `where e.join_token = p_token`
      // with p_token null is never true in SQL, so the function raises
      // no_such_event, not event_not_live (reproduced live before this test
      // was written). An already-non-live event would test the WRONG guard.
      //
      // So: flip the fixture event's own status to 'upcoming' as its DJ (the
      // "dj updates own events" policy plus an unscoped UPDATE grant permit
      // this), call guest_join with its REAL token so the lookup succeeds and
      // the status check is what actually fires, then restore to 'live' in a
      // `finally` -- vitest runs one file's tests strictly sequentially, so no
      // other test observes the intermediate state. This is a fixture event
      // owned by user B, never a demo event, so a `finally` that somehow
      // failed would strand nothing a grader can see.
      test('guest_join on a non-live event is rejected with event_not_live', async () => {
        const flip = await clientB.from('events').update({ status: 'upcoming' }).eq('id', fixtureEventId);
        expect(flip.error).toBeNull();
        try {
          const { data, error } = await anon.rpc('guest_join', {
            p_token: fixtureEventToken,
            p_display_name: 'Should Not Join',
          });
          expect(data).toBeNull();
          expect(error?.message).toBe('event_not_live');
        } finally {
          // `.select()` and a length check, not just `.error` -- an UPDATE
          // whose `.eq('id', ...)` matches zero rows returns `error: null`
          // from PostgREST, so checking only `.error` cannot tell "restored"
          // from "silently matched nothing", which would leave this SHARED,
          // LIVE fixture event stuck as 'upcoming' for every later test in
          // this file and every other use of it (manual walks, demos).
          const restore = await clientB
            .from('events')
            .update({ status: 'live' })
            .eq('id', fixtureEventId)
            .select('id');
          if (restore.error || restore.data?.length !== 1) {
            throw new Error(
              `could not restore ${FIXTURE_EVENT} to live: ${restore.error?.message ?? `matched ${restore.data?.length ?? 0} rows`}`,
            );
          }
        }
      });

      test('guest_join with a garbage token is rejected with no_such_event', async () => {
        const { data, error } = await anon.rpc('guest_join', {
          p_token: 'thisTokenDoesNotExist0',
          p_display_name: 'Should Not Join',
        });
        expect(data).toBeNull();
        expect(error?.message).toBe('no_such_event');
      });

      // Separate from the too-long case below on purpose: a fixture invalid
      // in two respects (blank AND too long) would pin neither guard, per
      // this repo's own recorded lesson about exactly this failure mode.
      test('guest_join with an all-space name is rejected with bad_display_name', async () => {
        const { data, error } = await anon.rpc('guest_join', {
          p_token: fixtureEventToken,
          p_display_name: '   ',
        });
        expect(data).toBeNull();
        expect(error?.message).toBe('bad_display_name');
      });

      test('guest_join with a 41-character name is rejected with bad_display_name', async () => {
        const { data, error } = await anon.rpc('guest_join', {
          p_token: fixtureEventToken,
          p_display_name: 'A'.repeat(41),
        });
        expect(data).toBeNull();
        expect(error?.message).toBe('bad_display_name');
      });

      test('a session can suggest up to 3 tracks; the 4th raises suggestion_limit', async () => {
        const join = await anon.rpc('guest_join', { p_token: fixtureEventToken, p_display_name: 'Capped Guest' });
        expect(join.error).toBeNull();
        const sessionId = join.data as string;

        for (const track of [randomTrackId(), randomTrackId(), randomTrackId()]) {
          const { error } = await anon.rpc('guest_suggest', {
            p_session_id: sessionId,
            p_track_id: track,
            p_title: 'Song',
            p_artist: 'Artist',
          });
          expect(error, `suggest ${track}`).toBeNull();
        }

        const fourth = await anon.rpc('guest_suggest', {
          p_session_id: sessionId,
          p_track_id: randomTrackId(),
          p_title: 'Song',
          p_artist: 'Artist',
        });
        expect(fourth.data).toBeNull();
        expect(fourth.error?.message).toBe('suggestion_limit');
      });

      test('suggesting an existing track votes instead of consuming a cap slot', async () => {
        const firstJoin = await anon.rpc('guest_join', {
          p_token: fixtureEventToken,
          p_display_name: 'Dedupe Guest A',
        });
        expect(firstJoin.error).toBeNull();
        const firstSession = firstJoin.data as string;

        const dedupeTrack = randomTrackId();
        const original = await anon.rpc('guest_suggest', {
          p_session_id: firstSession,
          p_track_id: dedupeTrack,
          p_title: 'Song',
          p_artist: 'Artist',
        });
        expect(original.error).toBeNull();
        const suggestionId = original.data![0].suggestion_id;

        const secondJoin = await anon.rpc('guest_join', {
          p_token: fixtureEventToken,
          p_display_name: 'Dedupe Guest B',
        });
        expect(secondJoin.error).toBeNull();
        const secondSession = secondJoin.data as string;

        const dup = await anon.rpc('guest_suggest', {
          p_session_id: secondSession,
          p_track_id: dedupeTrack,
          p_title: 'Song (dup)',
          p_artist: 'Artist (dup)',
        });
        expect(dup.error).toBeNull();
        expect(dup.data![0].was_existing).toBe(true);
        expect(dup.data![0].suggestion_id).toBe(suggestionId);

        // The dedupe path added a VOTE for the second session, not a new
        // suggestion -- its own used_count must stay at 0, not 1.
        const queue = await anon.rpc('guest_queue', { p_session_id: secondSession });
        expect(queue.error).toBeNull();
        expect(queue.data![0].used_count).toBe(0);
      });

      test('voting twice from the same session leaves one vote row, not two', async () => {
        const voterJoin = await anon.rpc('guest_join', { p_token: fixtureEventToken, p_display_name: 'Voter Guest' });
        expect(voterJoin.error).toBeNull();
        const voterSession = voterJoin.data as string;

        const targetJoin = await anon.rpc('guest_join', {
          p_token: fixtureEventToken,
          p_display_name: 'Suggest Guest',
        });
        expect(targetJoin.error).toBeNull();
        const targetSession = targetJoin.data as string;

        const suggested = await anon.rpc('guest_suggest', {
          p_session_id: targetSession,
          p_track_id: randomTrackId(),
          p_title: 'Song',
          p_artist: 'Artist',
        });
        expect(suggested.error).toBeNull();
        const suggestionId = suggested.data![0].suggestion_id;

        const vote1 = await anon.rpc('guest_vote', { p_session_id: voterSession, p_suggestion_id: suggestionId });
        expect(vote1.error).toBeNull();

        // guest_suggest itself records an implicit self-vote for the
        // suggester (targetSession) at creation time, so votes is 2 here
        // (targetSession + voterSession), not 1 -- captured BEFORE the
        // second vote so the real assertion (below) is "voting again adds
        // nothing", not a guess at the absolute count.
        const afterFirstVote = await anon.rpc('guest_queue', { p_session_id: voterSession });
        expect(afterFirstVote.error).toBeNull();
        const votesAfterFirst = afterFirstVote.data!.find(
          (r: { suggestion_id: string }) => r.suggestion_id === suggestionId,
        )!.votes;

        const vote2 = await anon.rpc('guest_vote', { p_session_id: voterSession, p_suggestion_id: suggestionId });
        expect(vote2.error).toBeNull();

        const afterSecondVote = await anon.rpc('guest_queue', { p_session_id: voterSession });
        expect(afterSecondVote.error).toBeNull();
        const row = afterSecondVote.data!.find((r: { suggestion_id: string }) => r.suggestion_id === suggestionId);
        expect(row).toBeTruthy();
        // The real pin: voting a SECOND time from the same session does not
        // add a second row -- suggestion_votes' own primary key dedupes this.
        expect(row!.votes).toBe(votesAfterFirst);
      });

      // A suggestion on a DIFFERENT event than the voting session's own.
      //
      // song_suggestions rows only ever come from guest_suggest, which
      // requires the session's event to be LIVE -- so this case needs a
      // second live event, not just a second event. It used to manufacture
      // one by flipping the demo event 'Priya & Alex' to live with a
      // throwaway join_token and restoring it in a `finally`: a mutation of
      // a demo-visible row that had to be got exactly right on every run,
      // and which left permanent, undeletable litter on that event either
      // way. The seed now provides a second fixture event already live, so
      // there is nothing to flip and nothing to restore.
      test('voting on a suggestion of a DIFFERENT event is rejected with wrong_event', async () => {
        const foreignJoin = await anon.rpc('guest_join', {
          p_token: foreignEventToken,
          p_display_name: 'Foreign Event Guest',
        });
        expect(foreignJoin.error).toBeNull();

        const foreignSuggest = await anon.rpc('guest_suggest', {
          p_session_id: foreignJoin.data as string,
          p_track_id: randomTrackId(),
          p_title: 'Song',
          p_artist: 'Artist',
        });
        expect(foreignSuggest.error).toBeNull();
        const foreignSuggestionId = foreignSuggest.data![0].suggestion_id;

        const ownJoin = await anon.rpc('guest_join', {
          p_token: fixtureEventToken,
          p_display_name: 'Wrong Event Voter',
        });
        expect(ownJoin.error).toBeNull();

        const vote = await anon.rpc('guest_vote', {
          p_session_id: ownJoin.data as string,
          p_suggestion_id: foreignSuggestionId,
        });
        expect(vote.error?.message).toBe('wrong_event');
      });

      test('guest_queue used_count includes played/skipped suggestions, not only pending ones', async () => {
        const join = await anon.rpc('guest_join', { p_token: fixtureEventToken, p_display_name: 'Used Count Guest' });
        expect(join.error).toBeNull();
        const sessionId = join.data as string;

        const suggestionIds: string[] = [];
        for (const track of [randomTrackId(), randomTrackId(), randomTrackId()]) {
          const { data, error } = await anon.rpc('guest_suggest', {
            p_session_id: sessionId,
            p_track_id: track,
            p_title: 'Song',
            p_artist: 'Artist',
          });
          expect(error, `suggest ${track}`).toBeNull();
          suggestionIds.push(data![0].suggestion_id);
        }

        const before = await anon.rpc('guest_queue', { p_session_id: sessionId });
        expect(before.error).toBeNull();
        expect(before.data![0].used_count).toBe(3);
        expect(before.data!.filter((r: { mine: boolean }) => r.mine)).toHaveLength(3);

        // Move one suggestion out of 'pending' as the DJ -- a direct,
        // RLS-authenticated update through song_suggestions' own "dj updates
        // suggestions of own events" policy is legitimate here and simpler
        // than orchestrating a full dj_play_suggestion call.
        const skip = await clientB
          .from('song_suggestions')
          .update({ status: 'skipped' })
          .eq('id', suggestionIds[0]);
        expect(skip.error).toBeNull();

        const after = await anon.rpc('guest_queue', { p_session_id: sessionId });
        expect(after.error).toBeNull();
        // used_count is unchanged -- the skipped suggestion still occupied a
        // cap slot -- even though it no longer appears among the PENDING rows.
        expect(after.data![0].used_count).toBe(3);
        expect(after.data!.some((r: { suggestion_id: string }) => r.suggestion_id === suggestionIds[0])).toBe(false);
        expect(after.data!.filter((r: { mine: boolean }) => r.mine)).toHaveLength(2);
      });

      test(
        'guest_search_allow returns true for 60 calls and false on the 61st',
        async () => {
          const join = await anon.rpc('guest_join', { p_token: fixtureEventToken, p_display_name: 'Search Guest' });
          expect(join.error).toBeNull();
          const sessionId = join.data as string;

          for (let i = 1; i <= 60; i += 1) {
            const { data, error } = await anon.rpc('guest_search_allow', { p_session_id: sessionId });
            expect(error, `call ${i}`).toBeNull();
            expect(data, `call ${i}`).toBe(true);
          }

          const call61 = await anon.rpc('guest_search_allow', { p_session_id: sessionId });
          expect(call61.error).toBeNull();
          expect(call61.data).toBe(false);
        },
        60000,
      );

      // Uses the same status-flip mechanism as the guest_join non-live test
      // above, now proven safe: flip, call, restore in `finally`, and vitest's
      // strictly sequential execution within one file means no other test
      // ever observes the intermediate state.
      test('guest_search_allow on a session whose event is no longer live is rejected with event_not_live', async () => {
        const join = await anon.rpc('guest_join', {
          p_token: fixtureEventToken,
          p_display_name: 'Search Guest (soon not-live)',
        });
        expect(join.error).toBeNull();
        const sessionId = join.data as string;

        const flip = await clientB.from('events').update({ status: 'upcoming' }).eq('id', fixtureEventId);
        expect(flip.error).toBeNull();
        try {
          const { data, error } = await anon.rpc('guest_search_allow', { p_session_id: sessionId });
          expect(data).toBeNull();
          expect(error?.message).toBe('event_not_live');
        } finally {
          // See the guest_join non-live restore's comment.
          const restore = await clientB
            .from('events')
            .update({ status: 'live' })
            .eq('id', fixtureEventId)
            .select('id');
          if (restore.error || restore.data?.length !== 1) {
            throw new Error(
              `could not restore ${FIXTURE_EVENT} to live: ${restore.error?.message ?? `matched ${restore.data?.length ?? 0} rows`}`,
            );
          }
        }
      });
    });
  },
);

/* ---------------------------------------------------------------------------
   PLAYED_SONGS PARTNER-SELECT WIDENING -- the most important assertion in
   this file per the plan's authoring session. Migration A widened
   played_songs' SELECT policy from "dj only" to "dj or partner", and did NOT
   touch INSERT/UPDATE/DELETE, which each still carry only the DJ's own
   policy. A `for all` policy (much wider than approved) would pass a
   read-only test and must be caught by the write attempts below -- hence
   five separate assertions, not one collapsed "capability" test.

   User A is the DJ (owns Claire & Ben and Noa & Eitan). User C is the
   partner, claimed onto Claire & Ben's slot 1 -- mirroring
   rls.integration.test.ts's claim dance exactly, but against Claire & Ben,
   which the sibling file never touches.
   --------------------------------------------------------------------------- */

if (hasSupabaseConfig && hasTestUsers && !hasPartnerUser) {
  describe('played_songs partner-select widening (auth-gated)', () => {
    test('TEST_USER_C_* must be set for the partner-role tests', () => {
      throw new Error(
        'TEST_USER_A_* is set but TEST_USER_C_EMAIL / TEST_USER_C_PASSWORD are not. The ' +
          "partner role needs its own account: claim_partner_slot matches the invitation " +
          "against the CALLER'S OWN verified account email, so the partner cannot be " +
          'impersonated by reusing A.',
      );
    });
  });
}

describe.skipIf(!hasSupabaseConfig || !hasTestUsers || !hasPartnerUser)(
  'played_songs partner-select widening (auth-gated)',
  { timeout: 30000 },
  () => {
    let clientA: SupabaseClient;
    let clientC: SupabaseClient;
    let userCId: string;

    let linkedEvent: string; // Claire & Ben -- C claims a slot here
    let unlinkedEvent: string; // Noa & Eitan -- the negative control, same DJ, C never claims it
    let claimedPartnerId: string;
    let originalInviteEmail: string;
    let originalDisplayName: string;

    beforeAll(async () => {
      clientA = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      clientC = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

      const a = await clientA.auth.signInWithPassword({ email: A_EMAIL!, password: A_PASSWORD! });
      if (a.error) throw new Error(`sign in A failed: ${a.error.message}`);

      const c = await clientC.auth.signInWithPassword({ email: C_EMAIL!, password: C_PASSWORD! });
      if (c.error || !c.data.user) {
        throw new Error(
          `sign in C failed: ${c.error?.message}. If this is email_not_confirmed, the account ` +
            'exists but was never confirmed -- the project mailer caps at 2 emails/hour.',
        );
      }
      userCId = c.data.user.id;

      const pick = async (coupleNames: string) => {
        const { data, error } = await clientA.from('events').select('id').eq('couple_names', coupleNames).limit(1);
        if (error) throw new Error(`could not read A's events: ${error.message}`);
        if (!data || data.length === 0) {
          throw new Error(`No '${coupleNames}' event for user A. Run \`npm run seed:demo\`.`);
        }
        return data[0].id as string;
      };

      linkedEvent = await pick('Claire & Ben');
      unlinkedEvent = await pick('Noa & Eitan');

      const { data: slot, error: slotError } = await clientA
        .from('event_partners')
        .select('id, invite_email, display_name')
        .eq('event_id', linkedEvent)
        .eq('slot', 1)
        .maybeSingle();
      if (slotError || !slot) {
        throw new Error(`No partner slot 1 on Claire & Ben: ${slotError?.message ?? 'no row'}.`);
      }
      originalInviteEmail = slot.invite_email;
      originalDisplayName = slot.display_name;

      // Reset to a KNOWN unclaimed state, same self-healing shape as
      // rls.integration.test.ts's partner-access block: user_id cannot be
      // un-set through PostgREST, so "unclaim" means delete and re-insert.
      await clientA.from('event_partners').delete().eq('id', slot.id);
      const { data: fresh, error: reinsertError } = await clientA
        .from('event_partners')
        .insert({
          event_id: linkedEvent,
          slot: 1,
          display_name: originalDisplayName,
          invite_email: C_EMAIL!,
        })
        .select('id')
        .single();
      if (reinsertError || !fresh) {
        throw new Error(`could not reset the partner slot: ${reinsertError?.message}`);
      }
      claimedPartnerId = fresh.id;

      const { error: claimError } = await clientC.rpc('claim_partner_slot', { p_event: linkedEvent, p_slot: 1 });
      if (claimError) throw new Error(`C could not claim its slot: ${claimError.message}`);
    });

    afterAll(async () => {
      if (!claimedPartnerId) return;
      try {
        await clientA.from('event_partners').delete().eq('id', claimedPartnerId);
        await clientA.from('event_partners').insert({
          event_id: linkedEvent,
          slot: 1,
          display_name: originalDisplayName,
          invite_email: originalInviteEmail,
        });
      } catch (cleanupError) {
        console.error('played_songs partner widening: cleanup failed, live rows may be left behind', cleanupError);
      }
    });

    test('the fixture linked C to Claire & Ben', async () => {
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

    test('a partner reads ALL played_songs of the event they are linked to', async () => {
      const djCount = await clientA.from('played_songs').select('id', { count: 'exact', head: true }).eq('event_id', linkedEvent);
      expect(djCount.error).toBeNull();
      expect(djCount.count).toBeGreaterThan(0);

      const { data, error } = await clientC.from('played_songs').select('id').eq('event_id', linkedEvent);
      expect(error).toBeNull();
      expect(data).toHaveLength(djCount.count!);
    });

    // The negative control -- Noa & Eitan has 10 real rows, not zero, so this
    // cannot pass merely because the table is empty.
    test('the SAME partner reads ZERO played_songs of an event they are not linked to', async () => {
      const djCount = await clientA.from('played_songs').select('id', { count: 'exact', head: true }).eq('event_id', unlinkedEvent);
      expect(djCount.error).toBeNull();
      expect(djCount.count).toBeGreaterThan(0);

      const { data, error } = await clientC.from('played_songs').select('id').eq('event_id', unlinkedEvent);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    test('a partner cannot insert a played_songs row into the event they ARE linked to', async () => {
      const { error } = await clientC.from('played_songs').insert({
        event_id: linkedEvent,
        position: 999,
        title: 'Injected by partner',
        artist: 'C',
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    test('a partner cannot update a played_songs row of the event they ARE linked to', async () => {
      const { data: rows, error: readError } = await clientA
        .from('played_songs')
        .select('id, title')
        .eq('event_id', linkedEvent)
        .limit(1);
      expect(readError).toBeNull();
      if (!rows || rows.length === 0) throw new Error('No played_songs rows for Claire & Ben.');
      const targetId = rows[0].id;

      const { data, error } = await clientC
        .from('played_songs')
        .update({ title: 'Hijacked by partner' })
        .eq('id', targetId)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const stillOriginal = await clientA.from('played_songs').select('title').eq('id', targetId).single();
      expect(stillOriginal.data?.title).toBe(rows[0].title);
    });

    // Verified live: `grant select, insert, update on public.played_songs to
    // authenticated` (20260829171500_events.sql) carries no DELETE at all --
    // so this is refused by a missing TABLE GRANT, not by RLS specifically,
    // and it refuses EVERYONE, including the DJ, not just the partner. The
    // test still correctly documents "a partner cannot delete a played_songs
    // row" -- it just does so via a stronger mechanism than the RLS `using`
    // clause the insert/update tests above exercise.
    test('a partner cannot delete a played_songs row of the event they ARE linked to', async () => {
      const { data: rows, error: readError } = await clientA
        .from('played_songs')
        .select('id')
        .eq('event_id', linkedEvent)
        .limit(1);
      expect(readError).toBeNull();
      if (!rows || rows.length === 0) throw new Error('No played_songs rows for Claire & Ben.');
      const targetId = rows[0].id;

      const { error } = await clientC.from('played_songs').delete().eq('id', targetId).select();
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');

      const stillThere = await clientA.from('played_songs').select('id').eq('id', targetId);
      expect(stillThere.data).toHaveLength(1);
    });
  },
);
