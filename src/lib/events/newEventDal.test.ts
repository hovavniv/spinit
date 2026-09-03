import { describe, test, expect, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUser() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, cache: <T,>(fn: T) => fn };
});

import { getEventForWizard } from './newEventDal';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = '22222222-2222-4333-8444-555555555555';

/**
 * A query-builder double recording every call, resolving to `result` at
 * `.maybeSingle()`. Each mock declares its parameters: a `vi.fn(async () => …)`
 * with none fails `tsc` the moment `.mock.calls[n][i]` indexes it.
 */
function builderDouble(result: { data: unknown; error: { message: string } | null }) {
  const calls = { select: [] as string[], eq: [] as [string, unknown][], in: [] as [string, unknown][], order: [] as unknown[][] };
  const builder = {
    select: vi.fn((columns: string) => { calls.select.push(columns); return builder; }),
    eq: vi.fn((column: string, value: unknown) => { calls.eq.push([column, value]); return builder; }),
    in: vi.fn((column: string, values: unknown) => { calls.in.push([column, values]); return builder; }),
    order: vi.fn((...args: unknown[]) => { calls.order.push(args); return builder; }),
    maybeSingle: vi.fn(async () => result),
  };
  return { builder, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: USER_ID });
});

describe('getEventForWizard', () => {
  test('returns null for a non-uuid id without querying at all', async () => {
    expect(await getEventForWizard('banana')).toBeNull();
    // `where id = 'banana'` raises 22P02 in Postgres, which would be logged as
    // a genuine database failure and surface as a 500 where a 404 belongs.
    expect(from).not.toHaveBeenCalled();
  });

  test('scopes the read to the signed-in DJ and to draft/upcoming', async () => {
    const { builder, calls } = builderDouble({ data: null, error: null });
    from.mockReturnValue(builder);

    await getEventForWizard(EVENT_ID);

    expect(calls.eq).toContainEqual(['id', EVENT_ID]);
    expect(calls.eq).toContainEqual(['dj_id', USER_ID]);
    // Without this the wizard is a working editor for a delivered recap
    // (design §2.3).
    expect(calls.in).toContainEqual(['status', ['draft', 'upcoming']]);
  });

  test('orders the embedded partner rows by slot', async () => {
    const { builder, calls } = builderDouble({ data: null, error: null });
    from.mockReturnValue(builder);

    await getEventForWizard(EVENT_ID);

    // Both rows are written by one statement, so created_at is byte-identical
    // (now() is transaction start time) and PostgREST returns tied rows in
    // whatever order the executor picks. Unordered, the confirmation screen
    // labels partner 1's link with partner 2's name (design §6.1).
    expect(calls.order).toContainEqual([
      'slot',
      { referencedTable: 'event_partners', ascending: true },
    ]);
  });

  test('returns null when the event is not found', async () => {
    const { builder } = builderDouble({ data: null, error: null });
    from.mockReturnValue(builder);

    expect(await getEventForWizard(EVENT_ID)).toBeNull();
  });

  test('returns null and logs when the query errors', async () => {
    // data set to a valid-shaped row (not null) alongside the error: with a
    // null-data fixture, `toBeNull()` would ALSO pass via the separate
    // `if (!data) return null` branch even if the `if (error)` guard above it
    // were deleted -- only a non-null data value here means `toBeNull()`
    // can only be satisfied by the error guard actually firing.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { builder } = builderDouble({
      data: { id: EVENT_ID, couple_names: 'Alex & Sam', status: 'draft' },
      error: { message: 'boom' },
    });
    from.mockReturnValue(builder);

    expect(await getEventForWizard(EVENT_ID)).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  test('maps the row and its partners', async () => {
    const { builder } = builderDouble({
      data: {
        id: EVENT_ID,
        couple_names: 'Alex & Sam',
        partner1_name: 'Alex',
        partner2_name: 'Sam',
        event_date: '2026-10-04',
        venue: 'Brookline Barn',
        guest_count: 120,
        status: 'draft',
        event_partners: [
          { slot: 1, display_name: 'Alex', invite_email: 'alex@example.org' },
          { slot: 2, display_name: 'Sam', invite_email: 'sam@example.org' },
        ],
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const event = await getEventForWizard(EVENT_ID);

    expect(event).toMatchObject({ id: EVENT_ID, guest_count: 120, status: 'draft' });
    expect(event?.partners).toHaveLength(2);
    expect(event?.partners[0]).toEqual({
      slot: 1,
      display_name: 'Alex',
      invite_email: 'alex@example.org',
    });
  });
});
