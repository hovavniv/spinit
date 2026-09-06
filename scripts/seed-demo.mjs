/* ---------------------------------------------------------------------------
   Demo data for the Past events screen, and (Task 19, live-event slice) one
   `live` event for the DJ's live screen, including guest-side data.
   docs/specs/2026-08-29-past-events-design.md §12.
   docs/specs/2026-09-04-live-event-design.md.

   The live event's GUEST-side rows (guest_sessions, song_suggestions,
   suggestion_votes) are seeded through the real anon-reachable RPCs
   (guest_join, guest_suggest, guest_vote -- Migration B, live as of
   2026-09-05), using a SEPARATE, unauthenticated Supabase client, exactly
   the path a real guest's browser takes. Not through a direct table insert
   as the DJ: `authenticated` has no insert grant on any of the three guest
   tables at all (design §3.6) -- the only insert path is those RPCs. This
   is deliberately not a compromise: it exercises the real guards (the <=3
   cap, the dedupe-into-a-vote rule) on the real boundary, which a direct
   insert never would have. Skipped entirely (idempotent) if the event
   already has any guest sessions, so re-running the seed does not keep
   minting new guests forever -- guest_join has no natural upsert key the
   way every other write in this script does.

   Signs in as a real DJ with the PUBLISHABLE (anon) key and writes through
   PostgREST, exactly as the app does. There is deliberately no service-role
   key anywhere in this repo. Two reasons, and the second is the stronger:

     - Least privilege. A service-role key bypasses RLS entirely.
     - A seed that bypasses RLS proves nothing. Going in through the same
       authenticated path the app uses means the seed succeeding IS evidence
       that the insert policies admit the owner.

   Plain .mjs, not TypeScript: this project has no tsx/ts-node/esbuild and no
   `engines` field, so a .ts script would run only on a Node new enough to
   strip types natively. This is the file a grader is most likely to run.

   Targets whatever .env.local points at -- hosted project or a local stack.

   Idempotent for ADDITIONS and EDITS, not for REMOVALS. Every write is an
   upsert on a derived id -- this script issues no delete anywhere -- so
   re-running converges only on additions and edits. If you shorten a
   `songs` array, or a fixture's `mustPlay`/`blocklist` array, and re-run,
   the rows you removed stay in the database; for `events` and
   `played_songs` this also means the counts in Task 6 Step 5 stop matching.
   Removing seeded data from any of the four tables (`events`,
   `played_songs`, `event_must_play`, `event_blocklist`) is a manual job
   until this script implements a delete pass. `event_must_play` and
   `event_blocklist` do have a delete policy and grant, unlike the other
   two, but that only means a delete is possible for them, not that this
   script performs one.
   --------------------------------------------------------------------------- */

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });

const {
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
} = process.env;

// SEED_DJ_* and TEST_USER_A_* are two names for ONE account: the RLS suite in
// src/lib/events/rls.integration.test.ts asserts on rows this script creates
// ('Ruth & Adam', 'Lena & Mark'), which only exist if the seed ran as user A.
// Defaulting here ties them together so they cannot drift. Set SEED_DJ_* only
// if you deliberately want to seed a different account -- and know that the
// RLS suite will then fail at beforeAll with a message about the seed.
const EMAIL = process.env.SEED_DJ_EMAIL ?? process.env.TEST_USER_A_EMAIL;
const PASSWORD = process.env.SEED_DJ_PASSWORD ?? process.env.TEST_USER_A_PASSWORD;

// The account that owns the integration-test fixture events (FIXTURE_EVENTS
// below). Deliberately NOT the demo DJ: see that constant's comment.
const FIXTURE_EMAIL = process.env.TEST_USER_B_EMAIL;
const FIXTURE_PASSWORD = process.env.TEST_USER_B_PASSWORD;

for (const [name, value] of [
  ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL],
  ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ANON_KEY],
  ['SEED_DJ_EMAIL or TEST_USER_A_EMAIL', EMAIL],
  ['SEED_DJ_PASSWORD or TEST_USER_A_PASSWORD', PASSWORD],
]) {
  if (!value) {
    console.error(`seed-demo: ${name} is not set in .env.local. Refusing to half-seed.`);
    process.exit(1);
  }
}

/**
 * A stable UUIDv5-shaped id derived from the DJ and a slug.
 *
 * Hardcoded UUID literals would only work for one DJ: events.id is a global
 * primary key, so the ids are single-tenant by construction and a second
 * account running this script would collide with the first DJ's rows.
 * Deriving from dj_id gives every DJ their own stable set, so the script is
 * re-runnable by anyone.
 *
 * (An earlier draft of this comment claimed the collision surfaces as a
 * duplicate-key violation rather than a policy denial. That is wrong: for
 * `insert ... on conflict do update` the rewriter attaches the UPDATE
 * policy's USING quals as a conflict check, so the error is 42501, "new row
 * violates row-level security policy (USING expression)" -- a policy denial,
 * and a clearer one than claimed. Attested from the rewriter's behaviour, not
 * run. The decision stands on single-tenancy alone, which needs no such
 * claim.)
 */
function derivedId(djId, slug) {
  const bytes = Buffer.from(createHash('sha1').update(`${djId}:${slug}`).digest()).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A date N days from today, as 'YYYY-MM-DD' in LOCAL time.
 *
 * Built from the local getFullYear/getMonth/getDate rather than
 * toISOString().slice(0, 10), which formats in UTC and lands on the wrong day
 * for anyone east of Greenwich late in the evening -- the same off-by-one this
 * project already fixed once in parseLocalDate (design §7).
 */
function inDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * A deterministic 22-char base62 join_token, matching the `join_token_shape`
 * CHECK (`^[A-Za-z0-9]{22}$`) -- derived the same way `derivedId` derives
 * event ids, so re-running the seed keeps the SAME token rather than
 * rotating it out from under a QR code already printed for a demo.
 *
 * `byte % 62` is measurably biased (256 is not a multiple of 62 --
 * `src/lib/live/token.ts`'s own doc comment on `randomToken` explains why),
 * which matters for the REAL token `startEvent` mints because it affects an
 * unguessability argument. It does not matter here: this token's only job is
 * to satisfy the CHECK constraint's character class for a fixed demo row,
 * not to resist guessing.
 */
function deriveToken(djId, slug) {
  const hash = createHash('sha256').update(`${djId}:${slug}:join-token`).digest();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 22; i += 1) token += alphabet[hash[i] % alphabet.length];
  return token;
}

/**
 * Asia/Jerusalem wall clock 'HH:mm' for `now` -- same composition
 * `startEvent` uses (src/lib/live/liveActions.ts), so the seeded row is
 * shaped exactly like one `startEvent` would have written.
 */
function jerusalemTime(now) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

// The first two match design/artboards/Spinit Past Events.dc.html exactly, so
// the screen can be compared against the artboard side by side. The third and
// fourth exist to make two things visible on the real screen that the
// artboard's two-event fixture never exercises: an event with zero songs
// (which must read "0 songs played", not 1 -- the count(s.id) case), and a
// cancelled event (which must NOT appear at all -- the view's where clause).
// The third also puts a third month group on screen.
//
// The fifth is for the OTHER branch, not this screen. feat/dashboard-data's
// upcoming-cards grid and its "in N days" chip currently have no row to render
// against a real database, because everything below is completed or cancelled.
// It is invisible here -- past_events_with_counts filters to
// status = 'completed' -- so it costs this slice one row and nothing else.
//
// There WAS deliberately no `live` row here (an earlier version of this
// comment said so) -- reasoning that no longer holds. It said nothing could
// transition a live event back out, which was true before the live-event
// slice existed: the DJ's "End event" button (src/lib/events/detailActions.ts)
// now moves `live -> completed` same as it always could for `upcoming`, so a
// seeded live event is not a permanent falsehood, only a temporary one an
// End click clears. The sixth event below (Task 19) is that row.
const EVENTS = [
  {
    slug: 'noa-eitan',
    couple_names: 'Noa & Eitan',
    venue: 'Franklin Hall',
    event_date: '2026-07-18',
    status: 'completed',
    songs: [
      ['At Last', 'Etta James', 'Dana R.'],
      ['September', 'Earth, Wind & Fire', 'Yuval'],
      ['Dancing Queen', 'ABBA', 'Tamar K.'],
      ['Superstition', 'Stevie Wonder', null],
      ['Levitating', 'Dua Lipa', 'Omer'],
      ['Hey Ya!', 'OutKast', 'Dana R.'],
      ['Sweet Caroline', 'Neil Diamond', 'Guest'],
      ['Blinding Lights', 'The Weeknd', 'Noa'],
      ['I Wanna Dance with Somebody', 'Whitney Houston', 'Eitan'],
      ['Closing Time', 'Semisonic', null],
    ],
    mustPlay: [],
    blocklist: [],
    notes: null,
  },
  {
    slug: 'claire-ben',
    couple_names: 'Claire & Ben',
    venue: 'Rooftop at Dune',
    event_date: '2026-06-06',
    status: 'completed',
    songs: [
      ['Signed, Sealed, Delivered', 'Stevie Wonder', 'Ben'],
      ['Valerie', 'Mark Ronson', 'Priya'],
      ['Uptown Funk', 'Mark Ronson', 'Claire'],
      ['Crazy in Love', 'Beyoncé', 'Alex M.'],
      ['Mr. Brightside', 'The Killers', null],
      ['Shut Up and Dance', 'Walk the Moon', 'Priya'],
      ['Take On Me', 'a-ha', 'Guest'],
      ['Time of My Life', 'Bill Medley', 'Claire'],
    ],
    mustPlay: [],
    blocklist: [],
    notes: null,
  },
  {
    slug: 'ruth-adam',
    couple_names: 'Ruth & Adam',
    venue: 'The Old Chapel',
    event_date: '2026-05-09',
    status: 'completed',
    songs: [], // must render "0 songs played"
    mustPlay: [],
    blocklist: [],
    notes: null,
  },
  {
    slug: 'lena-mark',
    couple_names: 'Lena & Mark',
    venue: 'Harbour House',
    event_date: '2026-04-11',
    status: 'cancelled',
    songs: [], // must NOT appear on the screen at all
    mustPlay: [],
    blocklist: [],
    notes: null,
  },
  {
    slug: 'maya-tom',
    couple_names: 'Maya & Tom',
    venue: 'Vineyard Terrace',
    // Computed, not hardcoded. A fixed future date silently becomes an
    // "upcoming" event whose date has already passed. Re-running the seed
    // refreshes it, and the id is derived from the slug, so it updates in
    // place instead of adding a second row.
    event_date: inDays(21),
    status: 'upcoming',
    songs: [], // an event that has not happened yet has no played songs
    mustPlay: [],
    blocklist: [],
    notes: null,
  },
  {
    slug: 'priya-alex',
    couple_names: 'Priya & Alex',
    venue: 'Brookline Barn',
    // Computed, never a fixed 2026-09-12: a hardcoded future date silently
    // becomes an "upcoming" event whose date has already passed -- the same
    // class of wrong data as the `live` row this seed omits, just slower to go
    // wrong. This is the row the event page is demonstrated against.
    event_date: inDays(13),
    status: 'upcoming',
    songs: [],
    // Every id below is a real Spotify id, looked up and verified against the
    // live catalogue (search + oEmbed) rather than invented -- the shape
    // constraint accepts an invented 22-character string just as happily as a
    // real one, and the picker would never match it (plan task 12).
    mustPlay: [
      ['ceremony', 'A Thousand Years', 'Christina Perri', 'Walking down the aisle', '6z5Yh7kOKeLjqIsNdokIpU'],
      ['ceremony', 'Hava Nagila', 'Traditional', 'Breaking the glass', '7Ihr8qtzuseTCJ7OmpxW5g'],
      ['reception', "Can't Help Falling in Love - Remastered", 'Elvis Presley', 'First dance', '7lCnb68Q8EGlC1Hkd7Nqsv'],
      ['party', 'September', 'Earth, Wind & Fire', 'Guaranteed dance-floor filler', '2grjqo0Frpf2okIBiifQKs'],
    ],
    blocklist: [
      ['party', 'artist', 'Nickelback', '6deZN1bslXzeGvOLaLMOIF'],
      ['party', 'song', 'Cha Cha Slide - Radio Edit — DJ Casper', '6DrfHG3wfZ64xIzpzuZxbf'],
    ],
    notes: "Alex's dad wants to do a surprise speech around 9pm — leave room in the timeline.",
  },
  {
    slug: 'sara-daniel',
    couple_names: 'Sara & Daniel',
    venue: 'The Old Chapel',
    // A live event's OWN date should already have arrived -- an event
    // "live" on a future date is exactly the kind of false data the old
    // no-live-row comment above was right to worry about, just for the
    // wrong reason (the real fix is a real date, not omitting the row).
    event_date: inDays(0),
    status: 'live',
    // Task 19: the live event's own columns, shaped exactly like startEvent
    // would have written them -- phase_started_at a little in the past so
    // minutesLeftInPhase has something real to compute against, not 0.
    phase: 'open-floor',
    phaseStartedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    songs: [],
    mustPlay: [
      // Same verified real ids as priya-alex's fixture -- looked up once,
      // reused rather than re-verified, since a Spotify id's shape needs no
      // per-event uniqueness.
      ['ceremony', 'A Thousand Years', 'Christina Perri', 'Walking down the aisle', '6z5Yh7kOKeLjqIsNdokIpU'],
      ['ceremony', 'Hava Nagila', 'Traditional', 'Breaking the glass', '7Ihr8qtzuseTCJ7OmpxW5g'],
      ['party', 'September', 'Earth, Wind & Fire', 'Guaranteed dance-floor filler', '2grjqo0Frpf2okIBiifQKs'],
    ],
    blocklist: [['party', 'artist', 'Nickelback', '6deZN1bslXzeGvOLaLMOIF']],
    notes: null,
  },
];

async function main() {
  const supabase = createClient(SUPABASE_URL, ANON_KEY);

  const signIn = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signIn.error || !signIn.data.user) {
    console.error(`seed-demo: could not sign in as ${EMAIL}: ${signIn.error?.message}`);
    process.exit(1);
  }
  const djId = signIn.data.user.id;
  console.log(`seed-demo: signed in as ${EMAIL}`);

  await seedEvents(supabase, djId, EVENTS);
  await seedGuestData(djId);

  console.log(`seed-demo: done. ${EVENTS.length} demo events.`);

  await seedTestFixtures();
}

/**
 * Upserts one group of events for one signed-in DJ.
 *
 * Extracted from `main` so the same body can seed both the DEMO events (user
 * A, the account a grader signs in as) and the INTEGRATION FIXTURE events
 * (user B, invisible to the demo) without duplicating three hundred lines of
 * upsert logic. `derivedId` already keys every row on the DJ's own id, so two
 * DJs seeding through this function never collide.
 */
async function seedEvents(supabase, djId, events) {
  for (const event of events) {
    const eventId = derivedId(djId, event.slug);

    const liveColumns =
      event.status === 'live'
        ? {
            phase: event.phase,
            phase_started_at: event.phaseStartedAt,
            start_time: jerusalemTime(new Date(event.phaseStartedAt)),
            join_token: deriveToken(djId, event.slug),
          }
        : {};

    const { error: eventError } = await supabase.from('events').upsert(
      {
        id: eventId,
        dj_id: djId,
        couple_names: event.couple_names,
        venue: event.venue,
        event_date: event.event_date,
        status: event.status,
        ...liveColumns,
      },
      { onConflict: 'id' },
    );
    if (eventError) {
      console.error(`seed-demo: failed to upsert event ${event.slug}: ${eventError.message}`);
      process.exit(1);
    }

    if (event.songs.length > 0) {
      const rows = event.songs.map(([title, artist, suggested_by], index) => ({
        id: derivedId(djId, `${event.slug}:song:${index + 1}`),
        event_id: eventId,
        position: index + 1,
        title,
        artist,
        suggested_by,
      }));

      const { error: songError } = await supabase
        .from('played_songs')
        .upsert(rows, { onConflict: 'id' });
      if (songError) {
        console.error(`seed-demo: failed to upsert songs for ${event.slug}: ${songError.message}`);
        process.exit(1);
      }
    }

    // Notes left `events` for their own table (design §5.2), so this is an
    // upsert into event_private_notes rather than an update on events -- the
    // old write now fails with PGRST204, the column is gone.
    //
    // Unconditional, not `if (event.notes)`. The migration backfills a row per
    // event, but an update against a missing row returns SUCCESS having
    // written nothing, so the seed must not depend on the row being there.
    const { error: notesError } = await supabase
      .from('event_private_notes')
      .upsert({ event_id: eventId, body: event.notes ?? '' }, { onConflict: 'event_id' });
    if (notesError) {
      console.error(`seed-demo: failed to set notes for ${event.slug}: ${notesError.message}`);
      process.exit(1);
    }

    // Two partner slots per event, both UNCLAIMED (user_id null) -- the state
    // the artboard draws as "Pending". The seed cannot claim them: user_id is
    // writable by no PostgREST role, and claim_partner_slot matches the
    // caller's own verified account email (design §2.6).
    //
    // ignoreDuplicates, so this is ON CONFLICT DO NOTHING. Two reasons, both
    // load-bearing:
    //   1. A real upsert's DO UPDATE SET would include event_id, which is NOT
    //      in the column-scoped update grant (slot, display_name,
    //      invite_email) -- the second seed run would fail with 42501.
    //   2. Re-seeding must not wipe a user_id someone has already claimed,
    //      which is exactly what a refresh would do mid-demo.
    //
    // @example.com addresses deliberately: these land in a database a grader
    // may read, and RFC 2606 reserves that domain so none of them can reach a
    // real inbox.
    //
    // Validated before use, not trusted: every current fixture is 'X & Y',
    // but a fixture without ' & ' would leave secondPartner undefined and
    // throw an uncaught TypeError at .toLowerCase() -- bypassing this
    // script's own console.error + process.exit(1) handling, the same as
    // every other failure below. localPart() also guards a multi-word name:
    // an email address containing a space has no format constraint on
    // event_partners to reject it, and claim_partner_slot's email match could
    // never satisfy it.
    const [firstPartner, secondPartner] = event.couple_names.split(' & ');
    if (!firstPartner?.trim() || !secondPartner?.trim()) {
      console.error(
        `seed-demo: couple_names for ${event.slug} is not "X & Y" (got ${JSON.stringify(event.couple_names)}), cannot derive partner slots`,
      );
      process.exit(1);
    }
    const localPart = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '.');
    const { error: partnerError } = await supabase.from('event_partners').upsert(
      [
        {
          event_id: eventId,
          slot: 1,
          display_name: firstPartner,
          invite_email: `${localPart(firstPartner)}.${event.slug}@example.com`,
        },
        {
          event_id: eventId,
          slot: 2,
          display_name: secondPartner,
          invite_email: `${localPart(secondPartner)}.${event.slug}@example.com`,
        },
      ],
      { onConflict: 'event_id,slot', ignoreDuplicates: true },
    );
    if (partnerError) {
      console.error(
        `seed-demo: failed to upsert partners for ${event.slug}: ${partnerError.message}`,
      );
      process.exit(1);
    }

    if (event.mustPlay.length > 0) {
      const rows = event.mustPlay.map(([segment, title, artist, moment, spotifyTrackId], index) => ({
        id: derivedId(djId, `${event.slug}:mustplay:${index + 1}`),
        event_id: eventId,
        segment,
        title,
        artist,
        moment,
        spotify_track_id: spotifyTrackId,
      }));
      const { error } = await supabase.from('event_must_play').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.error(`seed-demo: failed to upsert must-plays for ${event.slug}: ${error.message}`);
        process.exit(1);
      }
    }

    if (event.blocklist.length > 0) {
      const rows = event.blocklist.map(([segment, entry_type, value, spotifyId], index) => ({
        id: derivedId(djId, `${event.slug}:blocklist:${index + 1}`),
        event_id: eventId,
        segment,
        entry_type,
        value,
        // Genre entries carry no id (blocklist_id_matches_type, plan task 13);
        // this seed has none yet, but ?? null keeps a future genre tuple safe.
        spotify_id: spotifyId ?? null,
      }));
      const { error } = await supabase.from('event_blocklist').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.error(`seed-demo: failed to upsert blocklist for ${event.slug}: ${error.message}`);
        process.exit(1);
      }
    }

    console.log(
      `seed-demo: ${event.couple_names} (${event.status}) — ${event.songs.length} songs — ${eventId}`,
    );
  }
}

/**
 * Guest-side rows for the `sara-daniel` live event, through the real anon
 * RPCs (Task 19) -- a SEPARATE, unauthenticated client, exactly the path a
 * real guest's browser takes. Skipped entirely if the event already has any
 * guest sessions: `guest_join` mints a fresh row every call with no natural
 * upsert key, so re-running this unconditionally would add guests forever.
 *
 * Includes two guests suggesting the SAME track deliberately -- the
 * dedupe-into-a-vote path (`was_existing = true`, no cap slot consumed) is
 * the branch a fresh-context security review flagged as most likely to be
 * silently broken; seeding it end to end through the real RPCs, not just
 * proving it in isolated SQL, is worth the extra two lines.
 */
async function seedGuestData(djId) {
  const eventId = derivedId(djId, 'sara-daniel');
  const joinToken = deriveToken(djId, 'sara-daniel');

  // As the DJ (authenticated): checking for existing guest data is a SELECT,
  // which the DJ's own read policy already permits -- no anon client needed
  // for this idempotency check.
  const supabase = createClient(SUPABASE_URL, ANON_KEY);
  const signIn = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signIn.error) {
    console.error(`seed-demo: could not sign in to check for existing guest data: ${signIn.error.message}`);
    process.exit(1);
  }
  const { data: existing, error: existingError } = await supabase
    .from('guest_sessions')
    .select('id')
    .eq('event_id', eventId)
    .limit(1);
  if (existingError) {
    console.error(`seed-demo: failed to check for existing guest data: ${existingError.message}`);
    process.exit(1);
  }
  if (existing && existing.length > 0) {
    console.log('seed-demo: sara-daniel already has guest data, skipping (idempotent)');
    return;
  }

  // A genuinely separate, unauthenticated client -- persistSession: false so
  // it never shares a storage slot with the DJ client above (the two-client
  // gotcha CLAUDE.md records), though this script's short lifetime would
  // make that collision unlikely to matter here regardless.
  const guest = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  const sessions = [];
  for (const name of ['Table 1', 'Table 2', 'Table 3']) {
    const { data: sessionId, error } = await guest.rpc('guest_join', {
      p_token: joinToken,
      p_display_name: name,
    });
    if (error) {
      console.error(`seed-demo: guest_join failed for ${name}: ${error.message}`);
      process.exit(1);
    }
    sessions.push({ name, sessionId });
  }

  // Real, previously-verified Spotify ids (Task 12's live check, and the
  // priya-alex fixture above) -- not invented, per this file's own standard.
  const suggestions = [
    { by: 0, trackId: '2grjqo0Frpf2okIBiifQKs', title: 'September', artist: 'Earth, Wind & Fire' },
    { by: 1, trackId: '4PTG3Z6ehGkBFwjybzWkR8', title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
  ];
  const bySuggestionKey = new Map();
  for (const { by, trackId, title, artist } of suggestions) {
    const { data, error } = await guest.rpc('guest_suggest', {
      p_session_id: sessions[by].sessionId,
      p_track_id: trackId,
      p_title: title,
      p_artist: artist,
    });
    if (error) {
      console.error(`seed-demo: guest_suggest failed for ${sessions[by].name}: ${error.message}`);
      process.exit(1);
    }
    bySuggestionKey.set(trackId, data[0].suggestion_id);
  }

  // Guest 3 (index 2) suggests the SAME track guest 1 already suggested --
  // exercises the dedupe-into-a-vote path for real, through the boundary a
  // hostile caller would actually use.
  const { data: dup, error: dupError } = await guest.rpc('guest_suggest', {
    p_session_id: sessions[2].sessionId,
    p_track_id: '2grjqo0Frpf2okIBiifQKs',
    p_title: 'September (dup request)',
    p_artist: 'Earth, Wind & Fire',
  });
  if (dupError) {
    console.error(`seed-demo: guest_suggest (dedupe case) failed: ${dupError.message}`);
    process.exit(1);
  }
  if (!dup[0].was_existing) {
    console.error('seed-demo: expected the duplicate suggestion to dedupe into a vote, it did not');
    process.exit(1);
  }

  // Guest 2 also votes for "Never Gonna Give You Up" -- gives the demo a
  // vote-count difference to actually rank on, not just a flat list of 1s.
  const { error: voteError } = await guest.rpc('guest_vote', {
    p_session_id: sessions[1].sessionId,
    p_suggestion_id: bySuggestionKey.get('4PTG3Z6ehGkBFwjybzWkR8'),
  });
  if (voteError) {
    console.error(`seed-demo: guest_vote failed: ${voteError.message}`);
    process.exit(1);
  }

  console.log('seed-demo: seeded 3 guests, 2 distinct suggestions (one with 2 requesters via dedupe), 1 extra vote');
}

/**
 * The two events `src/lib/live/guest.integration.test.ts` owns.
 *
 * WHY THEY EXIST. That suite writes a guest session and up to three
 * `song_suggestions` rows per test, on every run, with placeholder text
 * ('Song' / 'Artist') and a freshly generated 22-character track id. Nothing
 * ever removes them: `authenticated` holds only SELECT and UPDATE on
 * `song_suggestions`, so the DJ genuinely cannot delete what the suite wrote.
 * The rows therefore accumulate for ever, one batch per `npm run gate`.
 *
 * Until 2026-09-06 they accumulated on the DEMO events -- Sara & Daniel and
 * Priya & Alex. The suite's own comment argued that was harmless because the
 * litter "sits inertly against an 'upcoming' event no guest-facing or DJ
 * screen currently reads suggestions from". That premise stopped being true
 * the moment Priya & Alex was started live: the DJ live screen read all 47
 * rows, each id 404'd against Spotify, and the poll route wrote the
 * `Unavailable track` / `—` sentinel for every one (by design -- see
 * `src/lib/live/liveTypes.ts`). The demo screen filled with 432 placeholder
 * requests. The bug was never in the sentinel; it was a test with no teardown
 * whose safety depended on an assumption about the rest of the app that
 * nothing re-checked when the app changed.
 *
 * WHY USER B. These events belong to TEST_USER_B, not to the seed's own DJ.
 * A grader signs in as user A, so nothing here can reach any screen they see
 * -- the litter is still un-deletable, but it is now un-demoable, which is
 * the property that actually matters. Keeping them under user A would have
 * put two obviously-fake events on the demo dashboard instead.
 *
 * WHY TWO, AND WHY BOTH ALREADY LIVE. The suite's `wrong_event` case needs a
 * suggestion belonging to a DIFFERENT event than the session voting on it.
 * It used to manufacture that by flipping the demo event Priya & Alex to
 * 'live' with a throwaway join token and restoring it in a `finally` -- a
 * mutation of a shared, demo-visible row that had to be got exactly right
 * every run. Seeding a second fixture event that is ALREADY live removes the
 * flip entirely.
 */
const FIXTURE_EVENTS = [
  {
    slug: 'integration-primary',
    couple_names: 'Integration A & Integration B',
    venue: 'Integration Fixture (not a demo event)',
    event_date: inDays(0),
    status: 'live',
    phase: 'open-floor',
    // A fixed offset like the demo live event's, so `minutesLeftInPhase` has
    // something real to compute against if anything ever reads it.
    phaseStartedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    songs: [],
    mustPlay: [],
    blocklist: [],
    notes: null,
  },
  {
    slug: 'integration-foreign',
    couple_names: 'Foreign A & Foreign B',
    venue: 'Integration Fixture (not a demo event)',
    event_date: inDays(0),
    status: 'live',
    phase: 'open-floor',
    phaseStartedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    songs: [],
    mustPlay: [],
    blocklist: [],
    notes: null,
  },
];

/**
 * Seeds FIXTURE_EVENTS under TEST_USER_B.
 *
 * Skipped with a loud line, not a hard failure, when TEST_USER_B_* is unset:
 * a grader running `npm run seed:demo` to look at the app needs neither the
 * fixtures nor a second account, and must not be stopped by their absence.
 * Anyone running the integration suite already has TEST_USER_B_* set --
 * `src/lib/events/rls.integration.test.ts` has required it since long before
 * this function existed.
 */
async function seedTestFixtures() {
  if (!FIXTURE_EMAIL || !FIXTURE_PASSWORD) {
    console.log(
      'seed-demo: TEST_USER_B_EMAIL/TEST_USER_B_PASSWORD not set — skipping the integration fixture events. ' +
        'src/lib/live/guest.integration.test.ts will fail at beforeAll without them.',
    );
    return;
  }

  // persistSession: false, per the two-clients gotcha in CLAUDE.md. Node has
  // no localStorage so this script would not actually hit it, but the rule is
  // cheaper to keep than to reason about each time.
  const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const signIn = await supabase.auth.signInWithPassword({
    email: FIXTURE_EMAIL,
    password: FIXTURE_PASSWORD,
  });
  if (signIn.error || !signIn.data.user) {
    console.error(`seed-demo: could not sign in as ${FIXTURE_EMAIL}: ${signIn.error?.message}`);
    process.exit(1);
  }

  await seedEvents(supabase, signIn.data.user.id, FIXTURE_EVENTS);
  console.log(
    `seed-demo: ${FIXTURE_EVENTS.length} integration fixture events under ${FIXTURE_EMAIL} (never shown in the demo).`,
  );
}

main().catch((error) => {
  console.error('seed-demo: unexpected failure', error);
  process.exit(1);
});
