import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();

// artist_genres upsert: upsert(row, opts).select()
const agUpsert = vi.fn();
const agUpsertSelect = vi.fn();

// artist_genres read (single artist): select(...).eq(...).eq(...).maybeSingle()
const agReadSelect = vi.fn();
const agReadEq1 = vi.fn();
const agReadEq2 = vi.fn();
const agReadMaybeSingle = vi.fn();

// artist_genres bulk read (readGenresForEvent): select(...).eq(...).eq(...)
// -- resolves directly, no .maybeSingle(). A different chain shape on the
// SAME table, so `select` itself dispatches on its columns argument (below).
const agBulkSelect = vi.fn();
const agBulkEq1 = vi.fn();
const agBulkEq2 = vi.fn();

// event_blocklist read: select(...).eq(...).eq(...)  (resolves directly, no further chain)
const blSelect = vi.fn();
const blEq1 = vi.fn();
const blEq2 = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));

import { writeGenres, readGenres, blockedGenres, writeGenreWeights, readGenresForEvent } from './genresDal';
import type { ArtistGenresRow } from './enrich';

// taste_profiles: update(row).eq('partner_id', p).select()
const tpUpdate = vi.fn();
const tpUpdateEq = vi.fn();
const tpUpdateSelect = vi.fn();

function tasteProfilesTable() {
  tpUpdateEq.mockReturnValue({ select: tpUpdateSelect });
  tpUpdate.mockReturnValue({ eq: tpUpdateEq });
  return { update: tpUpdate };
}

function artistGenresTable() {
  agUpsert.mockReturnValue({ select: agUpsertSelect });
  agReadEq2.mockReturnValue({ maybeSingle: agReadMaybeSingle });
  agReadEq1.mockReturnValue({ eq: agReadEq2 });
  agBulkEq1.mockReturnValue({ eq: agBulkEq2 });
  // Same table, two different `.select` call shapes distinguished by their
  // columns argument -- readGenres asks for the three facet columns of ONE
  // artist; readGenresForEvent asks for spotify_artist_id + genres across
  // every resolved artist on the event.
  agReadSelect.mockImplementation((columns: string) =>
    columns.startsWith('spotify_artist_id') ? { eq: agBulkEq1 } : { eq: agReadEq1 },
  );
  return { upsert: agUpsert, select: agReadSelect };
}

function eventBlocklistTable() {
  blEq2.mockReturnValue(Promise.resolve({ data: [], error: null }));
  blEq1.mockReturnValue({ eq: blEq2 });
  blSelect.mockReturnValue({ eq: blEq1 });
  return { select: blSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  agUpsertSelect.mockResolvedValue({ data: [{ event_id: 'e1' }], error: null });
  agReadMaybeSingle.mockResolvedValue({ data: null, error: null });
  agBulkEq2.mockResolvedValue({ data: [], error: null });
  tpUpdateSelect.mockResolvedValue({ data: [{ partner_id: 'p1' }], error: null });
  from.mockImplementation((table: string) => {
    if (table === 'artist_genres') return artistGenresTable();
    if (table === 'event_blocklist') return eventBlocklistTable();
    if (table === 'taste_profiles') return tasteProfilesTable();
    throw new Error(`unexpected table ${table}`);
  });
});

const resolvedRow: ArtistGenresRow = {
  event_id: 'e1',
  spotify_artist_id: 'a1',
  artist_name: 'Test Artist',
  musicbrainz_id: 'mb-1',
  musicbrainz_name: 'Test Artist',
  status: 'resolved',
  genres: { pop: 100 },
  origins: {},
  eras: {},
  resolved_via: 'mbid',
  attempts: 1,
  last_attempt_at: '2026-09-01T00:00:00.000Z',
  fetched_at: '2026-09-01T00:00:00.000Z',
};

describe('writeGenres', () => {
  it('resolves the row count from the upsert', async () => {
    agUpsertSelect.mockResolvedValueOnce({ data: [{ event_id: 'e1' }], error: null });
    await expect(writeGenres(resolvedRow)).resolves.toEqual({ rowCount: 1 });
  });

  it('surfaces a zero row count rather than throwing -- the caller decides what that means', async () => {
    agUpsertSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(writeGenres(resolvedRow)).resolves.toEqual({ rowCount: 0 });
  });

  it('throws when the upsert itself errors', async () => {
    agUpsertSelect.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await expect(writeGenres(resolvedRow)).rejects.toThrow(/artist_genres upsert failed/);
  });

  it(
    'sends a failed-status row to Supabase WITHOUT genres/origins/eras keys at all -- ' +
      'defaulting them to {} would clobber a previously-cached resolved row on retry',
    async () => {
      const failedRow: ArtistGenresRow = {
        event_id: 'e1',
        spotify_artist_id: 'a1',
        artist_name: 'Test Artist',
        musicbrainz_id: null,
        musicbrainz_name: null,
        status: 'failed',
        attempts: 2,
        last_attempt_at: '2026-09-01T00:00:00.000Z',
      };

      await writeGenres(failedRow);

      const sent = agUpsert.mock.calls[0][0] as Record<string, unknown>;
      expect('genres' in sent).toBe(false);
      expect('origins' in sent).toBe(false);
      expect('eras' in sent).toBe(false);
    },
  );

  it("sends a resolved row's facets through to the upsert", async () => {
    // Should-fix 13's positive control: the failed-row test above only
    // proves an ABSENT key stays absent, which is true by construction and
    // cannot fail. Nothing else asserted that a RESOLVED row's genres,
    // origins and eras actually reach Supabase -- the reviewer proved it by
    // stripping all three columns from every row and watching 242 tests stay
    // green.
    await writeGenres({
      ...resolvedRow,
      genres: { pop: 100 },
      origins: { israeli: 40 },
      eras: { '80s': 12 },
    });

    expect(agUpsert.mock.calls[0][0]).toMatchObject({
      genres: { pop: 100 },
      origins: { israeli: 40 },
      eras: { '80s': 12 },
    });
  });

  it('conflicts on the COMPOUND key -- a bare artist id would collide across events', async () => {
    await writeGenres(resolvedRow);

    expect(agUpsert.mock.calls[0][1]).toEqual({ onConflict: 'event_id,spotify_artist_id' });
  });
});

describe('writeGenreWeights', () => {
  const weights = { genres: { pop: 0.6 }, origins: { israeli: 0.4 }, eras: { '2010s': 1 } };

  it('resolves the row count from the update', async () => {
    tpUpdateSelect.mockResolvedValueOnce({ data: [{ partner_id: 'p1' }], error: null });
    await expect(writeGenreWeights('p1', weights)).resolves.toEqual({ rowCount: 1 });
  });

  it('surfaces a zero row count rather than throwing -- the caller decides what that means', async () => {
    tpUpdateSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(writeGenreWeights('p1', weights)).resolves.toEqual({ rowCount: 0 });
  });

  it('throws when the update itself errors', async () => {
    tpUpdateSelect.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await expect(writeGenreWeights('p1', weights)).rejects.toThrow(/genre-weights update failed/);
  });

  it(
    'scopes the update to this partner, via .eq, never by including partner_id in the payload',
    async () => {
      await writeGenreWeights('p1', weights);
      expect(tpUpdateEq).toHaveBeenCalledWith('partner_id', 'p1');
    },
  );

  it(
    'sends a payload that NEVER carries top_artists or computed_at -- sync.ts owns those two ' +
      'columns exclusively, and a write from here carrying them would clobber the artist ' +
      'list with whatever this caller happens to hold. Also a PLAIN UPDATE, not an upsert -- ' +
      'top_artists is NOT NULL with no default, and Postgres validates NOT NULL on an upsert\'s ' +
      'candidate insert row before conflict resolution, so a 4-column upsert 23502s even ' +
      'against an existing row',
    async () => {
      await writeGenreWeights('p1', weights);

      expect(tpUpdate).toHaveBeenCalledTimes(1);
      const sent = tpUpdate.mock.calls[0][0] as Record<string, unknown>;
      expect('top_artists' in sent).toBe(false);
      expect('computed_at' in sent).toBe(false);
      expect('partner_id' in sent).toBe(false);
      expect(sent).toMatchObject({
        genre_weights: weights.genres,
        origin_weights: weights.origins,
        era_weights: weights.eras,
      });
      expect(sent).toHaveProperty('enriched_at');
    },
  );
});

describe('readGenres', () => {
  it('resolves the three genre facets for an existing row', async () => {
    agReadMaybeSingle.mockResolvedValueOnce({
      data: { genres: { pop: 100 }, origins: { israeli: 50 }, eras: { '80s': 10 } },
      error: null,
    });
    await expect(readGenres('e1', 'a1')).resolves.toEqual({
      genres: { pop: 100 },
      origins: { israeli: 50 },
      eras: { '80s': 10 },
    });
  });

  it('resolves null when no row exists for that event/artist pair', async () => {
    agReadMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(readGenres('e1', 'missing')).resolves.toBeNull();
  });

  it('throws when the read errors', async () => {
    agReadMaybeSingle.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    await expect(readGenres('e1', 'a1')).rejects.toThrow(/artist_genres read failed/);
  });
});

describe('blockedGenres', () => {
  it('resolves the blocked genre values, filtered to entry_type = genre', async () => {
    blEq2.mockReturnValueOnce(Promise.resolve({ data: [{ value: 'disco' }, { value: 'metal' }], error: null }));
    await expect(blockedGenres('e1')).resolves.toEqual(['disco', 'metal']);
    expect(blEq2).toHaveBeenCalledWith('entry_type', 'genre');
  });

  it('resolves an empty list when nothing is blocked', async () => {
    blEq2.mockReturnValueOnce(Promise.resolve({ data: [], error: null }));
    await expect(blockedGenres('e1')).resolves.toEqual([]);
  });

  it('throws when the read errors', async () => {
    blEq2.mockReturnValueOnce(Promise.resolve({ data: null, error: { code: '500' } }));
    await expect(blockedGenres('e1')).rejects.toThrow(/event_blocklist read failed/);
  });
});

describe('readGenresForEvent', () => {
  it('returns one bulk read as spotifyArtistId -> genre -> weight, resolved rows only', async () => {
    agBulkEq2.mockResolvedValueOnce({
      data: [
        { spotify_artist_id: 'artist1aaaaaaaaaaaaaaa', genres: { pop: 100, disco: 72 } },
        { spotify_artist_id: 'artist2aaaaaaaaaaaaaaa', genres: { rock: 90 } },
      ],
      error: null,
    });

    const result = await readGenresForEvent('e1');

    expect(agBulkEq1).toHaveBeenCalledWith('event_id', 'e1');
    expect(agBulkEq2).toHaveBeenCalledWith('status', 'resolved');
    expect(result).toEqual({
      artist1aaaaaaaaaaaaaaa: { pop: 100, disco: 72 },
      artist2aaaaaaaaaaaaaaa: { rock: 90 },
    });
  });

  it('returns an empty object when nothing has resolved yet', async () => {
    agBulkEq2.mockResolvedValueOnce({ data: [], error: null });
    await expect(readGenresForEvent('e1')).resolves.toEqual({});
  });

  it('throws on a database error rather than returning a silently-empty map', async () => {
    agBulkEq2.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await expect(readGenresForEvent('e1')).rejects.toThrow();
  });
});
