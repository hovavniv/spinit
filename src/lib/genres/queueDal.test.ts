import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();

// enrichment_queue: update(...).eq(...).eq(...).select()
const qUpdate = vi.fn();
const qUpdateEq1 = vi.fn();
const qUpdateEq2 = vi.fn();
const qUpdateSelect = vi.fn();

// enrichment_queue: select('*', {count, head}).eq(...) [.not(...)]
const qCountSelect = vi.fn();
const qCountEq = vi.fn();
const qCountNot = vi.fn();

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

import { settle, releaseClaim, queueCounts } from './queueDal';

function enrichmentQueueTable() {
  qUpdateEq2.mockReturnValue({ select: qUpdateSelect });
  qUpdateEq1.mockReturnValue({ eq: qUpdateEq2 });
  qUpdate.mockReturnValue({ eq: qUpdateEq1 });

  qCountEq.mockReturnValue({ ...({} as { count: number; error: null }), not: qCountNot });
  qCountSelect.mockReturnValue({ eq: qCountEq });

  return { update: qUpdate, select: qCountSelect };
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
});
