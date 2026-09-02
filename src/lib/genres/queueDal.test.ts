import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();

// enrichment_queue: update(...).eq(...).eq(...).select() [settle/releaseClaim]
//               and: update(...).eq(...).in(...).select() [settleMany]
const qUpdate = vi.fn();
const qUpdateEq1 = vi.fn();
const qUpdateEq2 = vi.fn();
const qUpdateIn = vi.fn();
const qUpdateSelect = vi.fn();

// enrichment_queue: select('*', {count, head}).eq(...) [.not(...)]
const qCountSelect = vi.fn();
const qCountEq = vi.fn();
const qCountNot = vi.fn();

// enrichment_queue: select('artist_id').eq(...) [existingArtistIds]
const qReadEq = vi.fn();

// enrichment_queue: insert(...).select() [insertQueueRows]
const qInsert = vi.fn();
const qInsertSelect = vi.fn();

// artist_genres: select('attempts').eq(...).eq(...).maybeSingle()
const agReadSelect = vi.fn();
const agReadEq1 = vi.fn();
const agReadEq2 = vi.fn();
const agReadMaybeSingle = vi.fn();

// artist_genres: update(...).eq(...).eq(...).select()
const agUpdate = vi.fn();
const agUpdateEq1 = vi.fn();
const agUpdateEq2 = vi.fn();
const agUpdateSelect = vi.fn();

// event_partners: select('event_id').eq('id', partnerId).single()
const epSelect = vi.fn();
const epEq = vi.fn();
const epSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));

import { settle, releaseClaim, queueCounts, existingArtistIds, insertQueueRows, settleMany } from './queueDal';

function enrichmentQueueTable() {
  qUpdateEq2.mockReturnValue({ select: qUpdateSelect });
  qUpdateIn.mockReturnValue({ select: qUpdateSelect });
  qUpdateEq1.mockReturnValue({ eq: qUpdateEq2, in: qUpdateIn });
  qUpdate.mockReturnValue({ eq: qUpdateEq1 });

  qCountEq.mockReturnValue({ ...({} as { count: number; error: null }), not: qCountNot });
  qCountSelect.mockReturnValue({ eq: qCountEq });

  qInsert.mockReturnValue({ select: qInsertSelect });

  // select() is called with two different signatures depending on the
  // caller: `select('*', { count, head })` (queueCounts) vs
  // `select('artist_id')` (existingArtistIds) -- dispatch on the column arg
  // rather than reusing qCountEq's shape (which has no `data` field) for
  // both, since the two calls resolve to genuinely different row shapes.
  const select = vi.fn((column: string, opts?: unknown) => {
    if (column === 'artist_id') return { eq: qReadEq };
    return qCountSelect(column, opts);
  });

  return { update: qUpdate, select, insert: qInsert };
}

function artistGenresTable() {
  agReadEq2.mockReturnValue({ maybeSingle: agReadMaybeSingle });
  agReadEq1.mockReturnValue({ eq: agReadEq2 });
  agReadSelect.mockReturnValue({ eq: agReadEq1 });

  agUpdateEq2.mockReturnValue({ select: agUpdateSelect });
  agUpdateEq1.mockReturnValue({ eq: agUpdateEq2 });
  agUpdate.mockReturnValue({ eq: agUpdateEq1 });

  return { select: agReadSelect, update: agUpdate };
}

function eventPartnersTable() {
  epEq.mockReturnValue({ single: epSingle });
  epSelect.mockReturnValue({ eq: epEq });
  return { select: epSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  qUpdateSelect.mockResolvedValue({ data: [{ id: 'q1' }], error: null });
  qCountNot.mockResolvedValue({ count: 0, error: null });
  qReadEq.mockResolvedValue({ data: [], error: null });
  qInsertSelect.mockResolvedValue({ data: [{ id: 'q1' }], error: null });
  agReadMaybeSingle.mockResolvedValue({ data: { attempts: 1 }, error: null });
  agUpdateSelect.mockResolvedValue({ data: [{ event_id: 'e1' }], error: null });
  epSingle.mockResolvedValue({ data: { event_id: 'e1' }, error: null });

  from.mockImplementation((table: string) => {
    if (table === 'enrichment_queue') return enrichmentQueueTable();
    if (table === 'artist_genres') return artistGenresTable();
    if (table === 'event_partners') return eventPartnersTable();
    throw new Error(`unexpected table ${table}`);
  });
});

describe('settle', () => {
  it('resolves the row count of the settled queue row', async () => {
    qUpdateSelect.mockResolvedValueOnce({ data: [{ id: 'q1' }], error: null });
    await expect(settle('p1', 'a1')).resolves.toEqual({ rowCount: 1 });
  });

  it('surfaces a zero row count rather than throwing', async () => {
    qUpdateSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(settle('p1', 'a1')).resolves.toEqual({ rowCount: 0 });
  });

  it('throws when the update errors', async () => {
    qUpdateSelect.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    await expect(settle('p1', 'a1')).rejects.toThrow(/enrichment_queue settle failed/);
  });

  it('targets the row by BOTH partner_id and artist_id -- ' +
     'should-fix 14: no assertion here inspected the .eq() columns before', async () => {
    await settle('p1', 'a1');
    expect(qUpdateEq1).toHaveBeenCalledWith('partner_id', 'p1');
    expect(qUpdateEq2).toHaveBeenCalledWith('artist_id', 'a1');
  });
});

describe('releaseClaim', () => {
  it('clears the queue claim and advances the artist_genres backoff state', async () => {
    agReadMaybeSingle.mockResolvedValueOnce({ data: { attempts: 2 }, error: null });
    await releaseClaim('p1', 'a1');

    expect(qUpdate.mock.calls[0][0]).toMatchObject({ claimed_at: null });
    expect(agUpdate.mock.calls[0][0]).toMatchObject({ attempts: 3 });
    expect(agUpdate.mock.calls[0][0]).toHaveProperty('last_attempt_at');
  });

  it('resolves the ENRICHMENT_QUEUE update row count, not the artist_genres one', async () => {
    qUpdateSelect.mockResolvedValueOnce({ data: [{ id: 'q1' }], error: null });
    await expect(releaseClaim('p1', 'a1')).resolves.toEqual({ rowCount: 1 });
  });

  it('surfaces a zero row count when the queue release admits no rows', async () => {
    qUpdateSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(releaseClaim('p1', 'a1')).resolves.toEqual({ rowCount: 0 });
  });

  it('throws when the queue release itself errors', async () => {
    qUpdateSelect.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    await expect(releaseClaim('p1', 'a1')).rejects.toThrow(/enrichment_queue release failed/);
  });

  it('throws when the partner row cannot be resolved to an event', async () => {
    epSingle.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } });
    await expect(releaseClaim('missing', 'a1')).rejects.toThrow(/no event_partners row/);
  });

  it('clears the claim by BOTH partner_id and artist_id', async () => {
    await releaseClaim('p1', 'a1');
    expect(qUpdateEq1).toHaveBeenCalledWith('partner_id', 'p1');
    expect(qUpdateEq2).toHaveBeenCalledWith('artist_id', 'a1');
  });

  it("looks up the partner's event id by the partner's OWN id", async () => {
    await releaseClaim('p1', 'a1');
    expect(epEq).toHaveBeenCalledWith('id', 'p1');
  });

  it(
    'reads the current attempts count scoped to event_id, not partner_id -- ' +
      'mutating this to partnerId would reintroduce the attempts hot loop this ' +
      'file\'s own header comment documents fixing once already',
    async () => {
      await releaseClaim('p1', 'a1');
      expect(agReadEq1).toHaveBeenCalledWith('event_id', 'e1');
      expect(agReadEq2).toHaveBeenCalledWith('spotify_artist_id', 'a1');
    },
  );

  it(
    'writes the advanced backoff scoped to event_id, not partner_id -- ' +
      'same hot-loop risk one write over',
    async () => {
      await releaseClaim('p1', 'a1');
      expect(agUpdateEq1).toHaveBeenCalledWith('event_id', 'e1');
      expect(agUpdateEq2).toHaveBeenCalledWith('spotify_artist_id', 'a1');
    },
  );
});

describe('queueCounts', () => {
  it('counts enrichment_queue rows, total and settled', async () => {
    qCountEq.mockReturnValueOnce({ count: 5, error: null, not: qCountNot });
    qCountNot.mockResolvedValueOnce({ count: 2, error: null });

    await expect(queueCounts('p1')).resolves.toEqual({ total: 5, settled: 2 });
  });

  it(
    'counts the QUEUE, not the taste profile -- counting the merged artist list ' +
      'made "analysing" unable to clear (design §2.10)',
    async () => {
      await queueCounts('p1');
      expect(from).toHaveBeenCalledWith('enrichment_queue');
      expect(from).not.toHaveBeenCalledWith('taste_profiles');
    },
  );

  it('throws when the total count query errors', async () => {
    qCountEq.mockReturnValueOnce({ count: null, error: { code: '500' }, not: qCountNot });
    await expect(queueCounts('p1')).rejects.toThrow(/enrichment_queue total count failed/);
  });

  it('throws when the settled count query errors', async () => {
    qCountEq.mockReturnValueOnce({ count: 5, error: null, not: qCountNot });
    qCountNot.mockResolvedValueOnce({ count: null, error: { code: '500' } });
    await expect(queueCounts('p1')).rejects.toThrow(/enrichment_queue settled count failed/);
  });

  it('scopes both counts to the partner id', async () => {
    await queueCounts('p1');
    expect(qCountEq).toHaveBeenCalledWith('partner_id', 'p1');
  });

  it(
    'counts SETTLED rows via not(settled_at, is, null), not claimed rows -- ' +
      'the mutation the reviewer found made "still analysing" never clear ' +
      '(exactly the §2.10 defect this function\'s own docstring claims to prevent)',
    async () => {
      await queueCounts('p1');
      expect(qCountNot).toHaveBeenCalledWith('settled_at', 'is', null);
    },
  );
});

describe('existingArtistIds', () => {
  it('returns the set of artist ids already queued for a partner', async () => {
    qReadEq.mockResolvedValueOnce({ data: [{ artist_id: 'a1' }, { artist_id: 'a2' }], error: null });
    await expect(existingArtistIds('p1')).resolves.toEqual(new Set(['a1', 'a2']));
  });

  it('returns an empty set for a partner with no queue rows, not an error', async () => {
    qReadEq.mockResolvedValueOnce({ data: [], error: null });
    await expect(existingArtistIds('p1')).resolves.toEqual(new Set());
  });

  it('throws when the read errors', async () => {
    qReadEq.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    await expect(existingArtistIds('p1')).rejects.toThrow(/enrichment_queue read failed/);
  });
});

describe('insertQueueRows', () => {
  it('inserts partner_id/artist_id/position for each row', async () => {
    qInsertSelect.mockResolvedValueOnce({ data: [{ id: 'q1' }, { id: 'q2' }], error: null });
    await insertQueueRows('p1', [{ artistId: 'a1', position: 0 }, { artistId: 'a2', position: 1 }]);
    expect(qInsert).toHaveBeenCalledWith([
      { partner_id: 'p1', artist_id: 'a1', position: 0 },
      { partner_id: 'p1', artist_id: 'a2', position: 1 },
    ]);
  });

  it('is a no-op that never touches the table when rows is empty', async () => {
    await expect(insertQueueRows('p1', [])).resolves.toEqual({ rowCount: 0 });
    expect(qInsert).not.toHaveBeenCalled();
  });

  it('throws when the insert errors', async () => {
    qInsertSelect.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    await expect(insertQueueRows('p1', [{ artistId: 'a1', position: 0 }]))
      .rejects.toThrow(/enrichment_queue insert failed/);
  });

  it('surfaces a zero-row insert as an error rather than reporting success', async () => {
    qInsertSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(insertQueueRows('p1', [{ artistId: 'a1', position: 0 }]))
      .rejects.toThrow(/enrichment_queue insert wrote no rows/);
  });
});

describe('settleMany', () => {
  it('settles every row whose artist_id is in the given list', async () => {
    qUpdateSelect.mockResolvedValueOnce({ data: [{ id: 'q1' }, { id: 'q2' }], error: null });
    await settleMany('p1', ['a1', 'a2']);
    expect(qUpdate.mock.calls[0][0]).toHaveProperty('settled_at');
    expect(qUpdateIn).toHaveBeenCalledWith('artist_id', ['a1', 'a2']);
  });

  it('is a no-op that never touches the table when artistIds is empty', async () => {
    await expect(settleMany('p1', [])).resolves.toEqual({ rowCount: 0 });
    expect(qUpdate).not.toHaveBeenCalled();
  });

  it('throws when the settle errors', async () => {
    qUpdateSelect.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    await expect(settleMany('p1', ['a1'])).rejects.toThrow(/enrichment_queue settle-many failed/);
  });

  it('surfaces a zero-row settle as an error rather than reporting success', async () => {
    qUpdateSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(settleMany('p1', ['a1'])).rejects.toThrow(/enrichment_queue settle-many wrote no rows/);
  });
});
