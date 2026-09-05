import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ---------------------------------------------------------------------------
   WHY THIS FILE EXISTS (design §7.1, Task 24).

   readActivity merges two independently-queried tables (song_suggestions'
   "requested" verb, suggestion_votes' "backed" verb) into one feed. This is
   its own test file, separate from liveDal.test.ts, because that file's
   song_suggestions/suggestion_votes mocks are hand-wired to readLiveState's
   OWN exact chain shapes (`.eq().eq().order().order()` for suggestions,
   `.select().in()` for votes) -- readActivity calls the same two tables with
   different chain shapes (`.eq().gte().order().order().limit()`, a second
   bare `.eq()` lookup, and `.in().gte().order().order().order().limit()`),
   and sharing one mock module between two differently-shaped call patterns
   on the same tables would make either file's assertions ambiguous about
   which call they are checking.
   --------------------------------------------------------------------------- */

const EVENT = '11111111-1111-4111-8111-111111111111';

// ---- song_suggestions, 1st call per readActivity invocation: the "requested"
// read -- .select().eq().gte().order().order().limit() ----
const requestedSelectArg = { value: '' };
const requestedEqCalls: [string, unknown][] = [];
const requestedGteCalls: [string, unknown][] = [];
const requestedOrderCalls: [string, unknown][] = [];
const requestedResult = vi.fn();
const requestedLimit = vi.fn(() => requestedResult());
const requestedOrder2 = vi.fn((col: string, opts: unknown) => {
  requestedOrderCalls.push([col, opts]);
  return { limit: requestedLimit };
});
const requestedOrder1 = vi.fn((col: string, opts: unknown) => {
  requestedOrderCalls.push([col, opts]);
  return { order: requestedOrder2 };
});
const requestedGte = vi.fn((col: string, val: unknown) => {
  requestedGteCalls.push([col, val]);
  return { order: requestedOrder1 };
});
const requestedEq = vi.fn((col: string, val: unknown) => {
  requestedEqCalls.push([col, val]);
  return { gte: requestedGte };
});

// ---- song_suggestions, 2nd call per invocation: the unfiltered lookup --
// .select().eq(), resolves directly ----
const lookupSelectArg = { value: '' };
const lookupEqCalls: [string, unknown][] = [];
const lookupResult = vi.fn();
const lookupEq = vi.fn((col: string, val: unknown) => {
  lookupEqCalls.push([col, val]);
  return lookupResult();
});

let suggestionsSelectCallCount = 0;
const suggestionsSelect = vi.fn((cols: string) => {
  suggestionsSelectCallCount += 1;
  if (suggestionsSelectCallCount % 2 === 1) {
    requestedSelectArg.value = cols;
    return { eq: requestedEq };
  }
  lookupSelectArg.value = cols;
  return { eq: lookupEq };
});

// ---- suggestion_votes: .select().in().gte().order().order().order().limit() ----
const votesSelectArg = { value: '' };
const votesInCalls: [string, unknown][] = [];
const votesGteCalls: [string, unknown][] = [];
const votesOrderCalls: [string, unknown][] = [];
const votesResult = vi.fn();
const votesLimit = vi.fn(() => votesResult());
const votesOrder3 = vi.fn((col: string, opts: unknown) => {
  votesOrderCalls.push([col, opts]);
  return { limit: votesLimit };
});
const votesOrder2 = vi.fn((col: string, opts: unknown) => {
  votesOrderCalls.push([col, opts]);
  return { order: votesOrder3 };
});
const votesOrder1 = vi.fn((col: string, opts: unknown) => {
  votesOrderCalls.push([col, opts]);
  return { order: votesOrder2 };
});
const votesGte = vi.fn((col: string, val: unknown) => {
  votesGteCalls.push([col, val]);
  return { order: votesOrder1 };
});
const votesIn = vi.fn((col: string, ids: unknown) => {
  votesInCalls.push([col, ids]);
  return { gte: votesGte };
});
const votesSelect = vi.fn((cols: string) => {
  votesSelectArg.value = cols;
  return { in: votesIn };
});

const from = vi.fn((table: string) => {
  if (table === 'song_suggestions') return { select: suggestionsSelect };
  if (table === 'suggestion_votes') return { select: votesSelect };
  throw new Error(`readActivity.test.ts: unexpected table "${table}"`);
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from })),
}));

import { readActivity } from './liveDal';

function suggestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    title: 'September',
    artist: 'Earth, Wind & Fire',
    created_at: '2026-09-04T20:00:00.000Z',
    guest_sessions: { display_name: 'Noa' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  suggestionsSelectCallCount = 0;
  requestedEqCalls.length = 0;
  requestedGteCalls.length = 0;
  requestedOrderCalls.length = 0;
  lookupEqCalls.length = 0;
  votesInCalls.length = 0;
  votesGteCalls.length = 0;
  votesOrderCalls.length = 0;
  requestedResult.mockResolvedValue({ data: [], error: null });
  lookupResult.mockResolvedValue({ data: [], error: null });
  votesResult.mockResolvedValue({ data: [], error: null });
});

describe('readActivity', () => {
  it('reads song_suggestions with the disambiguated FK embed, matching readLiveState', async () => {
    await readActivity(EVENT);

    expect(requestedSelectArg.value).toContain('guest_sessions!song_suggestions_suggested_by_fkey');
  });

  it('filters the "requested" read to this event and a created_at cutoff of about one hour ago', async () => {
    const before = Date.now();
    await readActivity(EVENT);
    const after = Date.now();

    expect(requestedEqCalls).toContainEqual(['event_id', EVENT]);
    expect(requestedGteCalls).toHaveLength(1);
    const [col, cutoffIso] = requestedGteCalls[0];
    expect(col).toBe('created_at');
    const cutoffMs = new Date(cutoffIso as string).getTime();
    // cutoff must be "now - 1h", computed in TypeScript (CLAUDE.md: never a
    // Postgres-side interval expression) -- checked with generous slack
    // against the test's own wall clock, not an exact match.
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 60 * 60 * 1000 - 5_000);
    expect(cutoffMs).toBeLessThanOrEqual(after - 60 * 60 * 1000 + 5_000);
  });

  it('orders the "requested" read by created_at, id descending -- newest first, deterministic tiebreaker', async () => {
    await readActivity(EVENT);

    expect(requestedOrderCalls).toContainEqual(['created_at', { ascending: false }]);
    expect(requestedOrderCalls).toContainEqual(['id', { ascending: false }]);
  });

  it('a suggestion from 30 minutes ago appears with the requested verb and the guest\'s display name', async () => {
    requestedResult.mockResolvedValue({
      data: [suggestionRow({ created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() })],
      error: null,
    });
    lookupResult.mockResolvedValue({
      data: [{ id: 's1', title: 'September', artist: 'Earth, Wind & Fire' }],
      error: null,
    });

    const activity = await readActivity(EVENT);

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      verb: 'requested',
      guestName: 'Noa',
      title: 'September',
      artist: 'Earth, Wind & Fire',
    });
  });

  it('a suggestion from 2 hours ago is excluded by the cutoff the DB is asked to filter on', async () => {
    // The mock cannot itself replay Postgres' `gte` filtering -- this
    // configures the mock the way a real Postgres response WOULD look (an
    // old row never comes back at all) and separately asserts (above) that
    // the cutoff sent to `.gte()` is the correct "now - 1h" value, so the
    // two together stand in for "the DB would filter this out".
    requestedResult.mockResolvedValue({ data: [], error: null });

    const activity = await readActivity(EVENT);

    expect(activity).toEqual([]);
  });

  it('a vote from 20 minutes ago appears with the backed verb, the voter\'s name, and the TARGETED suggestion\'s title/artist -- not the voter\'s own', async () => {
    lookupResult.mockResolvedValue({
      data: [{ id: 's-old', title: 'Uptown Funk', artist: 'Bruno Mars' }],
      error: null,
    });
    votesResult.mockResolvedValue({
      data: [
        {
          suggestion_id: 's-old',
          guest_id: 'g-voter',
          created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          guest_sessions: { display_name: 'Eitan' },
        },
      ],
      error: null,
    });

    const activity = await readActivity(EVENT);

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      verb: 'backed',
      guestName: 'Eitan',
      title: 'Uptown Funk',
      artist: 'Bruno Mars',
    });
  });

  it('looks up suggestion_votes scoped to ALL of this event\'s suggestion ids, not just the recent "requested" ones', async () => {
    // The suggestion a vote targets can be well over an hour old -- the
    // lookup query has no time filter for exactly this reason.
    lookupResult.mockResolvedValue({
      data: [
        { id: 's-recent', title: 'Recent Song', artist: 'A' },
        { id: 's-very-old', title: 'Old Song', artist: 'B' },
      ],
      error: null,
    });

    await readActivity(EVENT);

    expect(lookupEqCalls).toContainEqual(['event_id', EVENT]);
    expect(votesInCalls).toHaveLength(1);
    const [, ids] = votesInCalls[0];
    expect(ids).toEqual(['s-recent', 's-very-old']);
  });

  it('skips the suggestion_votes query entirely when this event has no suggestions at all', async () => {
    lookupResult.mockResolvedValue({ data: [], error: null });

    await readActivity(EVENT);

    expect(votesIn).not.toHaveBeenCalled();
  });

  it('puts a newer vote ahead of an older suggestion regardless of which table it came from', async () => {
    requestedResult.mockResolvedValue({
      data: [suggestionRow({ id: 's1', created_at: '2026-09-04T18:00:00.000Z' })],
      error: null,
    });
    lookupResult.mockResolvedValue({
      data: [{ id: 's1', title: 'September', artist: 'Earth, Wind & Fire' }],
      error: null,
    });
    votesResult.mockResolvedValue({
      data: [
        {
          suggestion_id: 's1',
          guest_id: 'g-voter',
          created_at: '2026-09-04T19:00:00.000Z',
          guest_sessions: { display_name: 'Eitan' },
        },
      ],
      error: null,
    });

    const activity = await readActivity(EVENT);

    expect(activity.map((a) => a.verb)).toEqual(['backed', 'requested']);
  });

  it('caps the merged result at 20 even when more than 20 events exist across both tables combined', async () => {
    const requestedData = Array.from({ length: 15 }, (_, i) =>
      suggestionRow({
        id: `s-req-${i}`,
        created_at: new Date(Date.now() - i * 60 * 1000).toISOString(),
      }),
    );
    lookupResult.mockResolvedValue({
      data: requestedData.map((r) => ({ id: r.id, title: r.title, artist: r.artist })),
      error: null,
    });
    requestedResult.mockResolvedValue({ data: requestedData, error: null });
    votesResult.mockResolvedValue({
      data: Array.from({ length: 15 }, (_, i) => ({
        suggestion_id: requestedData[0].id,
        guest_id: `g-${i}`,
        created_at: new Date(Date.now() - (i + 100) * 60 * 1000).toISOString(),
        guest_sessions: { display_name: `Guest ${i}` },
      })),
      error: null,
    });

    const activity = await readActivity(EVENT);

    expect(activity).toHaveLength(20);
  });

  it('breaks a created_at tie deterministically, by id descending', async () => {
    requestedResult.mockResolvedValue({
      data: [
        suggestionRow({ id: 's-a', created_at: '2026-09-04T18:00:00.000Z', title: 'Song A' }),
        suggestionRow({ id: 's-b', created_at: '2026-09-04T18:00:00.000Z', title: 'Song B' }),
      ],
      error: null,
    });
    lookupResult.mockResolvedValue({
      data: [
        { id: 's-a', title: 'Song A', artist: 'X' },
        { id: 's-b', title: 'Song B', artist: 'Y' },
      ],
      error: null,
    });

    const activity = await readActivity(EVENT);

    // id descending: 'requested-s-b' > 'requested-s-a' lexically.
    expect(activity.map((a) => a.title)).toEqual(['Song B', 'Song A']);
  });

  it('orders and limits the suggestion_votes read the same created_at-desc, tiebreaker, cap discipline', async () => {
    lookupResult.mockResolvedValue({ data: [{ id: 's1', title: 'A', artist: 'B' }], error: null });

    await readActivity(EVENT);

    expect(votesGteCalls).toHaveLength(1);
    expect(votesGteCalls[0][0]).toBe('created_at');
    expect(votesOrderCalls).toContainEqual(['created_at', { ascending: false }]);
    expect(votesOrderCalls).toContainEqual(['suggestion_id', { ascending: false }]);
    expect(votesOrderCalls).toContainEqual(['guest_id', { ascending: false }]);
  });

  it('throws on a database error from the "requested" read rather than returning a partial feed', async () => {
    requestedResult.mockResolvedValue({ data: null, error: { code: '42501', message: 'boom' } });

    await expect(readActivity(EVENT)).rejects.toThrow();
  });

  it('throws on a database error from the suggestion_votes read', async () => {
    lookupResult.mockResolvedValue({ data: [{ id: 's1', title: 'A', artist: 'B' }], error: null });
    votesResult.mockResolvedValue({ data: null, error: { code: '42501', message: 'boom' } });

    await expect(readActivity(EVENT)).rejects.toThrow();
  });
});
