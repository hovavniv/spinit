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

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from })),
}));
vi.mock('@/lib/auth/dal', () => ({
  requireUser: vi.fn(async () => ({ id: 'dj-1' })),
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
    couple_status: 'awaiting-couple',
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
  builder();
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
      { id: 'p1', slot: 1, display_name: 'Noa', user_id: null },
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
});
