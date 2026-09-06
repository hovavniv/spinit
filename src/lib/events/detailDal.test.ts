import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ---------------------------------------------------------------------------
   WHY THIS FILE EXISTS.

   There was no test around getEventDetail, and that is precisely how the
   embed-shape bug survived: the Supabase client carries no generated `Database`
   type, so `data` is untyped and tsc happily accepts array-indexing an object.
   106 unit and component tests passed while both note bodies read as '' and the
   next save wrote that '' over a real note.

   The assertions that matter here are therefore about SHAPE, not about SQL:
   PostgREST returns a to-ONE embed as an object and a to-MANY embed as an
   array, and this one select mixes both. Nothing else in the suite can catch a
   regression there.
   --------------------------------------------------------------------------- */

const maybeSingle = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const from = vi.fn();

/*
 * artist_genres is a SEPARATE query (`.from('artist_genres')...`, no
 * `.order()`/`.maybeSingle()`), so it needs its own chain, routed by table
 * name through the shared `from` mock below. `genreEq2` is the terminal
 * call -- its return value IS what `await ...eq(...).eq(...)` resolves to,
 * since `await` on a plain (non-Promise) object just resolves to that object
 * immediately. `genreEqCalls` records both `.eq()` calls' arguments, in
 * order, so a test can assert on `event_id` and `status` independently
 * without caring which position the implementation calls them in.
 */
const genreEqCalls: [string, unknown][] = [];
const genreRows = vi.fn();
const genreEq2 = vi.fn((col: string, val: unknown) => {
  genreEqCalls.push([col, val]);
  return genreRows();
});
const genreEq1 = vi.fn((col: string, val: unknown) => {
  genreEqCalls.push([col, val]);
  return { eq: genreEq2 };
});
const genreSelect = vi.fn(() => ({ eq: genreEq1 }));

/*
 * enrichment_queue is its own chain too (fix-spec Blocker 1): a plain
 * `.select('partner_id, settled_at').in('partner_id', ids)`, no `.order()`/
 * `.maybeSingle()` -- same reasoning as artist_genres above, routed through
 * the same shared `from` mock by table name.
 */
const queueIn = vi.fn();
const queueSelect = vi.fn(() => ({ in: queueIn }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) =>
      table === 'artist_genres'
        ? { select: genreSelect }
        : table === 'enrichment_queue'
          ? { select: queueSelect }
          : from(table),
  })),
}));
vi.mock('@/lib/auth/dal', () => ({
  requireUser: vi.fn(async () => ({ id: 'dj-1' })),
}));
// The DAL now asks Spotify for a thumbnail per stored id. Mocked so no test
// makes a network call -- and so the ids it is HANDED can be asserted, which
// is the half a component test cannot see: a component fed a fixture map
// stays green even when nothing in production ever fills that map.
const resolveArtwork = vi.fn(async (_input: { trackIds: unknown[]; artistIds: unknown[] }) => ({}) as Record<string, string>);
vi.mock('@/lib/spotify/artwork', () => ({
  resolveArtwork: (input: { trackIds: unknown[]; artistIds: unknown[] }) => resolveArtwork(input),
}));
// react's `cache` memoises per request; in a test that would make the second
// call with the same id return the first call's result.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, cache: (fn: unknown) => fn };
});

import { getEventDetail } from './detailDal';

const EVENT = '11111111-1111-4111-8111-111111111111';

/** A chainable builder: every .order() returns itself, .maybeSingle() resolves. */
function builder() {
  const chain = {
    select,
    eq,
    order: vi.fn(() => chain),
    maybeSingle,
  };
  select.mockReturnValue(chain);
  eq.mockReturnValue(chain);
  from.mockReturnValue(chain);
  return chain;
}

/** A row as PostgREST actually returns it: notes to-ONE, partners to-MANY. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT,
    dj_id: 'dj-1',
    couple_names: 'Noa & Eitan',
    event_private_notes: { body: 'speech at 9pm' },
    event_shared_notes: { body: 'both of us agreed' },
    event_partners: [{ id: 'p1', slot: 1, display_name: 'Noa', user_id: null }],
    event_must_play: [],
    event_blocklist: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  genreEqCalls.length = 0;
  builder();
  // Default: no artist enriched yet. Individual tests override with
  // genreRows.mockResolvedValue(...).
  genreRows.mockResolvedValue({ data: [], error: null });
  // Default: no queue rows yet. Individual tests override with
  // queueIn.mockResolvedValue(...).
  queueIn.mockResolvedValue({ data: [], error: null });
  resolveArtwork.mockResolvedValue({});
});

describe('getEventDetail', () => {
  it('reads a to-ONE note embed returned as an OBJECT', async () => {
    // The bug this file was written for. Both note tables make event_id their
    // PRIMARY KEY as well as their foreign key, which is PostgREST's one-to-one
    // detection condition, so these come back as `{ body }` -- not `[{ body }]`.
    // Indexing [0] yielded undefined, the field rendered empty, and the next
    // save wrote '' over the stored note.
    maybeSingle.mockResolvedValue({ data: row(), error: null });

    const detail = await getEventDetail(EVENT);

    expect(detail?.privateNotes).toBe('speech at 9pm');
    expect(detail?.sharedNotes).toBe('both of us agreed');
  });

  it('still reads a note embed if it arrives as an ARRAY', async () => {
    // firstRow() normalises both shapes on purpose: the migration is not
    // pushed, so the real shape has never been observed against a server.
    maybeSingle.mockResolvedValue({
      data: row({
        event_private_notes: [{ body: 'from an array' }],
        event_shared_notes: [{ body: 'also an array' }],
      }),
      error: null,
    });

    const detail = await getEventDetail(EVENT);

    expect(detail?.privateNotes).toBe('from an array');
    expect(detail?.sharedNotes).toBe('also an array');
  });

  it('reads the to-MANY partner embed as an array', async () => {
    // event_partners' foreign key is NOT unique, so this one genuinely is a
    // list. Three embeds in one select, two shapes.
    maybeSingle.mockResolvedValue({ data: row(), error: null });

    const detail = await getEventDetail(EVENT);

    expect(detail?.partners).toEqual([
      { id: 'p1', slot: 1, display_name: 'Noa', user_id: null, connection: null, profile: null },
    ]);
  });

  it("defaults a partner's filtered-out private note to an empty string", async () => {
    // A partner's read returns NO private-note row at all, because the policy
    // filters it. That is the boundary working, not a failed load.
    maybeSingle.mockResolvedValue({
      data: row({ event_private_notes: null }),
      error: null,
    });

    const detail = await getEventDetail(EVENT);

    expect(detail?.privateNotes).toBe('');
    expect(detail?.sharedNotes).toBe('both of us agreed');
  });

  it('does NOT filter by dj_id, so a linked partner reaches the same row', async () => {
    // The read filters by the caller's RELATIONSHIP to the row, not ownership
    // (design §6.2). RLS is the control. Re-adding .eq('dj_id') would lock
    // every partner out with no failing test anywhere else.
    maybeSingle.mockResolvedValue({ data: row(), error: null });

    await getEventDetail(EVENT);

    expect(eq).toHaveBeenCalledWith('id', EVENT);
    expect(eq).not.toHaveBeenCalledWith('dj_id', expect.anything());
  });

  it('selects dj_id, which the route needs to resolve the viewer', async () => {
    maybeSingle.mockResolvedValue({ data: row(), error: null });

    const detail = await getEventDetail(EVENT);

    expect(select.mock.calls[0][0]).toContain('dj_id');
    expect(detail?.dj_id).toBe('dj-1');
  });

  it('selects the Spotify identity columns on both list tables', async () => {
    // The select list names columns explicitly and this repo has no generated
    // Database type, so a column left off the string arrives `undefined` at
    // runtime with `typecheck` still green -- this is the check that would
    // have caught it.
    maybeSingle.mockResolvedValue({ data: row(), error: null });

    await getEventDetail(EVENT);

    expect(select.mock.calls[0][0]).toMatch(/spotify_track_id/);
    expect(select.mock.calls[0][0]).toMatch(/spotify_artist_id/);
    expect(select.mock.calls[0][0]).toMatch(/spotify_id/);
  });

  it('maps the Spotify id fields through on must-play and blocklist rows', async () => {
    maybeSingle.mockResolvedValue({
      data: row({
        event_must_play: [{
          id: 'm1', segment: 'party', title: 'September', artist: 'Earth, Wind & Fire',
          moment: null, spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa',
          spotify_artist_id: 'bbbbbbbbbbbbbbbbbbbbbb', created_at: '2026-01-01',
        }],
        event_blocklist: [{
          id: 'b1', segment: 'party', entry_type: 'song', value: 'X — Y',
          spotify_id: 'cccccccccccccccccccccc', created_at: '2026-01-01',
        }],
      }),
      error: null,
    });

    const detail = await getEventDetail(EVENT);

    expect(detail?.mustPlay[0].spotify_track_id).toBe('aaaaaaaaaaaaaaaaaaaaaa');
    expect(detail?.mustPlay[0].spotify_artist_id).toBe('bbbbbbbbbbbbbbbbbbbbbb');
    expect(detail?.blocklist[0].spotify_id).toBe('cccccccccccccccccccccc');
  });

  it('does not select notes, a column the migration drops', async () => {
    // Leaving `notes` in the select returns 42703 once the column is gone; the
    // error branch below turns that into null and the page into notFound(), so
    // EVERY event page would 404 with no compile error and no failing test.
    maybeSingle.mockResolvedValue({ data: row(), error: null });

    await getEventDetail(EVENT);

    expect(select.mock.calls[0][0]).not.toMatch(/\bnotes\b(?!_)/);
  });

  it('returns null when the row is absent', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(getEventDetail(EVENT)).resolves.toBeNull();
  });

  it('returns null on a database error rather than throwing', async () => {
    maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'boom', code: '42703' },
    });

    await expect(getEventDetail(EVENT)).resolves.toBeNull();
  });

  it('does not select refresh_token, in any shape', async () => {
    maybeSingle.mockResolvedValue({ data: row(), error: null });

    await getEventDetail(EVENT);

    expect(JSON.stringify(select.mock.calls[0][0])).not.toContain('refresh_token');
    expect(JSON.stringify(select.mock.calls[0][0])).not.toContain('spotify_tokens');
  });

  it('maps a to-one connection embed arriving as an OBJECT', async () => {
    maybeSingle.mockResolvedValue({
      data: row({
        event_partners: [
          {
            id: 'p1',
            slot: 1,
            display_name: 'Noa',
            user_id: null,
            spotify_connections: { status: 'connected' },
          },
        ],
      }),
      error: null,
    });

    const detail = await getEventDetail(EVENT);

    expect(detail?.partners[0].connection?.status).toBe('connected');
  });

  it('maps the same embed arriving as an ARRAY, so the code is right either way', async () => {
    maybeSingle.mockResolvedValue({
      data: row({
        event_partners: [
          {
            id: 'p1',
            slot: 1,
            display_name: 'Noa',
            user_id: null,
            spotify_connections: [{ status: 'failed' }],
          },
        ],
      }),
      error: null,
    });

    const detail = await getEventDetail(EVENT);

    expect(detail?.partners[0].connection?.status).toBe('failed');
  });

  it('maps top_artists (snake) onto topArtists (camel)', async () => {
    maybeSingle.mockResolvedValue({
      data: row({
        event_partners: [
          {
            id: 'p1',
            slot: 1,
            display_name: 'Noa',
            user_id: null,
            taste_profiles: {
              top_artists: [{ id: 'a', name: 'A', artworkUrl: null, score: 1, ranges: [] }],
              computed_at: '2026-01-01',
            },
          },
        ],
      }),
      error: null,
    });

    const detail = await getEventDetail(EVENT);

    expect(detail?.partners[0].profile?.topArtists).toHaveLength(1);
  });

  it('yields a null connection and null profile rather than throwing when the embed is absent', async () => {
    maybeSingle.mockResolvedValue({
      data: row({
        event_partners: [{ id: 'p1', slot: 1, display_name: 'Noa', user_id: null }],
      }),
      error: null,
    });

    const detail = await getEventDetail(EVENT);

    expect(detail?.partners[0].connection).toBeNull();
    expect(detail?.partners[0].profile).toBeNull();
  });

  describe('genresByArtistId (plan task 8b)', () => {
    // Without this block, TasteProfile would render `genresByArtistId={}` in
    // production forever -- nothing upstream ever populated the field, even
    // though the enrichment queue (tasks 1-8) runs correctly. See the plan's
    // own framing of this task.

    it('reads resolved genres for the event, keyed by artist id', async () => {
      maybeSingle.mockResolvedValue({ data: row(), error: null });
      genreRows.mockResolvedValue({
        data: [
          { spotify_artist_id: 'a1', genres: { mizrahi: 100, pop: 40 } },
          { spotify_artist_id: 'a2', genres: { rock: 90 } },
        ],
        error: null,
      });

      const detail = await getEventDetail(EVENT);

      expect(detail?.genresByArtistId).toEqual({
        a1: { mizrahi: 100, pop: 40 },
        a2: { rock: 90 },
      });
    });

    it('filters to status resolved -- a failed row has no usable genres', async () => {
      maybeSingle.mockResolvedValue({ data: row(), error: null });

      await getEventDetail(EVENT);

      expect(genreEqCalls).toContainEqual(['status', 'resolved']);
    });

    it('scopes to THIS event -- artist_genres is per-event since the C2 migration', async () => {
      maybeSingle.mockResolvedValue({ data: row(), error: null });

      await getEventDetail(EVENT);

      expect(genreEqCalls).toContainEqual(['event_id', EVENT]);
    });

    it('returns {} rather than undefined when no artist has been enriched yet', async () => {
      maybeSingle.mockResolvedValue({ data: row(), error: null });
      genreRows.mockResolvedValue({ data: [], error: null });

      const detail = await getEventDetail(EVENT);

      expect(detail?.genresByArtistId).toEqual({});
    });

    it('surfaces a query error rather than silently returning {}', async () => {
      // {} and "the query failed" render identically -- as no genre panels.
      // They must not be the same value, or a real failure would silently
      // read as "nothing enriched yet" forever.
      maybeSingle.mockResolvedValue({ data: row(), error: null });
      genreRows.mockResolvedValue({ data: null, error: { code: '42501' } });

      await expect(getEventDetail(EVENT)).rejects.toThrow(/artist_genres/);
    });
  });

  describe('enrichmentProgress (fix-spec Blocker 1)', () => {
    // Without this, the DJ -- who cannot poll /api/spotify/enrich-next -- has
    // no way to ever see real progress, and TasteProfile's `total === 0`
    // branch reads as "nobody has connected yet" forever.

    it('sums settled/total across BOTH partners queue rows', async () => {
      maybeSingle.mockResolvedValue({
        data: row({
          event_partners: [
            { id: 'p1', slot: 1, display_name: 'Noa', user_id: null },
            { id: 'p2', slot: 2, display_name: 'Eitan', user_id: null },
          ],
        }),
        error: null,
      });
      queueIn.mockResolvedValue({
        data: [
          { partner_id: 'p1', settled_at: '2026-01-01' },
          { partner_id: 'p1', settled_at: null },
          { partner_id: 'p2', settled_at: '2026-01-01' },
        ],
        error: null,
      });

      const detail = await getEventDetail(EVENT);

      expect(detail?.enrichmentProgress).toEqual({ settled: 2, total: 3 });
    });

    it('queries enrichment_queue scoped to the event\'s own partner ids', async () => {
      maybeSingle.mockResolvedValue({ data: row(), error: null });

      await getEventDetail(EVENT);

      expect(queueIn).toHaveBeenCalledWith('partner_id', ['p1']);
    });

    it('returns {settled: 0, total: 0} when no queue rows exist yet', async () => {
      maybeSingle.mockResolvedValue({ data: row(), error: null });
      queueIn.mockResolvedValue({ data: [], error: null });

      const detail = await getEventDetail(EVENT);

      expect(detail?.enrichmentProgress).toEqual({ settled: 0, total: 0 });
    });

    it('surfaces a query error rather than silently returning zero progress', async () => {
      maybeSingle.mockResolvedValue({ data: row(), error: null });
      queueIn.mockResolvedValue({ data: null, error: { code: '42501' } });

      await expect(getEventDetail(EVENT)).rejects.toThrow(/enrichment_queue/);
    });
  });
});

describe('getEventDetail artwork', () => {
  const TRACK_A = 'aaaaaaaaaaaaaaaaaaaaaa';
  const TRACK_B = 'bbbbbbbbbbbbbbbbbbbbbb';
  const ARTIST_A = 'cccccccccccccccccccccc';

  function rowsWithIds() {
    return row({
      event_must_play: [
        { id: 'm1', segment: 'party', title: 'A', artist: 'X', moment: null, spotify_track_id: TRACK_A, spotify_artist_id: null, created_at: '2026-09-01T00:00:00Z' },
      ],
      event_blocklist: [
        { id: 'b1', segment: 'party', entry_type: 'song', value: 'B', spotify_id: TRACK_B, created_at: '2026-09-01T00:00:00Z' },
        { id: 'b2', segment: 'party', entry_type: 'artist', value: 'C', spotify_id: ARTIST_A, created_at: '2026-09-01T00:00:00Z' },
        { id: 'b3', segment: 'party', entry_type: 'genre', value: 'pop', spotify_id: null, created_at: '2026-09-01T00:00:00Z' },
      ],
    });
  }

  it('asks for a TRACK id per must-play row and per blocklisted SONG, and an ARTIST id per blocklisted artist', async () => {
    // The namespaces are not interchangeable: blocklist.spotify_id is a track
    // id on a 'song' row and an artist id on an 'artist' row, out of ONE
    // column. Sending an artist id to /tracks/{id} 404s silently and the
    // picture just never appears, which no rendering test can distinguish
    // from "Spotify had no artwork".
    maybeSingle.mockResolvedValue({ data: rowsWithIds(), error: null });

    await getEventDetail(EVENT);

    expect(resolveArtwork).toHaveBeenCalledTimes(1);
    const input = resolveArtwork.mock.calls[0][0];
    expect(input.trackIds).toEqual([TRACK_A, TRACK_B]);
    expect(input.artistIds).toEqual([ARTIST_A]);
  });

  it('never asks for a genre row (it has no id and no artwork)', async () => {
    maybeSingle.mockResolvedValue({ data: rowsWithIds(), error: null });

    await getEventDetail(EVENT);

    const input = resolveArtwork.mock.calls[0][0];
    expect(input.trackIds).not.toContain(null);
    expect(input.artistIds).not.toContain(null);
  });

  it('threads the resolved map onto the returned event', async () => {
    maybeSingle.mockResolvedValue({ data: rowsWithIds(), error: null });
    resolveArtwork.mockResolvedValue({ [`track:${TRACK_A}`]: 'https://i.example/a.jpg' });

    const detail = await getEventDetail(EVENT);

    expect(detail?.artworkById).toEqual({ [`track:${TRACK_A}`]: 'https://i.example/a.jpg' });
  });
});
