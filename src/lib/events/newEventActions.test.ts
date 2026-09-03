import { describe, test, expect, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); });
const from = vi.fn();

vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUser() }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));
vi.mock('./newEventDal', () => ({
  getEventForWizard: vi.fn(async (eventId: string) => ({
    id: eventId,
    couple_names: 'Alex & Sam',
    partner1_name: 'Alex',
    partner2_name: 'Sam',
    event_date: '2026-10-04',
    venue: 'Brookline Barn',
    guest_count: 120,
    status: 'draft',
    partners: [],
  })),
}));

import { saveEventDraft, sendInvites } from './newEventActions';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = '22222222-2222-4333-8444-555555555555';

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const draftFields = {
  eventId: '',
  partner1Name: 'Alex',
  partner2Name: 'Sam',
  eventDate: '2026-10-04',
  venue: 'Brookline Barn',
  guestCount: '120',
};

/** Records the payload handed to insert/update and what predicates followed. */
function eventsDouble(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const calls = {
    insert: [] as Record<string, unknown>[],
    update: [] as Record<string, unknown>[],
    eq: [] as [string, unknown][],
    in: [] as [string, unknown][],
  };
  const builder = {
    insert: vi.fn((payload: Record<string, unknown>) => { calls.insert.push(payload); return builder; }),
    update: vi.fn((payload: Record<string, unknown>) => { calls.update.push(payload); return builder; }),
    eq: vi.fn((column: string, value: unknown) => { calls.eq.push([column, value]); return builder; }),
    in: vi.fn((column: string, values: unknown) => { calls.in.push([column, values]); return builder; }),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    then: undefined as unknown,
  };
  // `.update(...).eq(...).eq(...)` is awaited directly, with no maybeSingle.
  (builder as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve(result);
  return { builder, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: USER_ID });
});

describe('saveEventDraft — insert path', () => {
  test('sets dj_id and status draft, and composes couple_names', async () => {
    const { builder, calls } = eventsDouble({ data: { id: EVENT_ID }, error: null });
    from.mockReturnValue(builder);

    await expect(saveEventDraft(null, formData(draftFields))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(calls.insert[0]).toMatchObject({
      dj_id: USER_ID,
      status: 'draft',
      couple_names: 'Alex & Sam',
      partner1_name: 'Alex',
      partner2_name: 'Sam',
      venue: 'Brookline Barn',
      event_date: '2026-10-04',
      guest_count: 120,
    });
  });

  test('redirects to the invite step with the new id', async () => {
    const { builder } = eventsDouble({ data: { id: EVENT_ID }, error: null });
    from.mockReturnValue(builder);

    await expect(saveEventDraft(null, formData(draftFields))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirect).toHaveBeenCalledWith(`/events/new/${EVENT_ID}/invite`);
  });

  test('returns field errors without touching the database', async () => {
    const result = await saveEventDraft(null, formData({ ...draftFields, venue: '' }));

    expect(result).toMatchObject({ ok: false });
    expect(from).not.toHaveBeenCalled();
  });

  test('returns the generic message on a database error, and logs the code', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { builder } = eventsDouble({ data: null, error: { code: '23514', message: 'boom' } });
    from.mockReturnValue(builder);

    const result = await saveEventDraft(null, formData(draftFields));

    expect(result).toEqual({ ok: false, message: 'Could not save that. Try again.' });
    expect(redirect).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('saveEventDraft — update path', () => {
  const updateFields = { ...draftFields, eventId: EVENT_ID };

  test('never writes status', async () => {
    const { builder, calls } = eventsDouble({ data: null, error: null });
    from.mockReturnValue(builder);

    await expect(saveEventDraft(null, formData(updateFields))).rejects.toThrow(/NEXT_REDIRECT/);

    // A DJ walking back into step 1 from step 2 must not demote an event that
    // step 2 already promoted to 'upcoming'.
    expect(calls.update[0]).not.toHaveProperty('status');
  });

  test('carries the draft-or-upcoming predicate', async () => {
    const { builder, calls } = eventsDouble({ data: null, error: null });
    from.mockReturnValue(builder);

    await expect(saveEventDraft(null, formData(updateFields))).rejects.toThrow(/NEXT_REDIRECT/);

    // The second layer behind §2.3's route guard: a server action is a public
    // endpoint reachable without ever loading the page.
    expect(calls.in).toContainEqual(['status', ['draft', 'upcoming']]);
    expect(calls.eq).toContainEqual(['id', EVENT_ID]);
  });
});

/**
 * A double for the two tables sendInvites touches, keyed by table name, so one
 * test can assert on both the partner write and the promotion.
 */
function twoTableDouble(options: {
  partnersError?: { code?: string; message: string } | null;
  eventsError?: { code?: string; message: string } | null;
} = {}) {
  const calls = {
    upsert: [] as [unknown, unknown][],
    update: [] as { table: string; payload: Record<string, unknown>; eq: [string, unknown][] }[],
  };

  function builderFor(table: string) {
    const eq: [string, unknown][] = [];
    const error = table === 'event_partners' ? options.partnersError ?? null : options.eventsError ?? null;
    const builder = {
      upsert: vi.fn((rows: unknown, opts: unknown) => { calls.upsert.push([rows, opts]); return builder; }),
      update: vi.fn((payload: Record<string, unknown>) => {
        calls.update.push({ table, payload, eq });
        return builder;
      }),
      eq: vi.fn((column: string, value: unknown) => { eq.push([column, value]); return builder; }),
    };
    (builder as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: null, error });
    return builder;
  }

  return { builderFor, calls };
}

const inviteFields = {
  eventId: EVENT_ID,
  email1: 'alex@example.org',
  email2: 'sam@example.org',
};

describe('sendInvites', () => {
  test('creates both partner rows in one call, with ON CONFLICT DO NOTHING', async () => {
    const { builderFor, calls } = twoTableDouble();
    from.mockImplementation((table: string) => builderFor(table));

    await expect(sendInvites(null, formData(inviteFields))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(calls.upsert).toHaveLength(1);
    const [rows, opts] = calls.upsert[0];
    expect(rows).toHaveLength(2);
    // DO UPDATE would fail 42501 on the second run against the column-scoped
    // update grant. This assertion is the guard against reintroducing it.
    expect(opts).toEqual({ onConflict: 'event_id,slot', ignoreDuplicates: true });
  });

  test('applies the current values with one update per slot', async () => {
    const { builderFor, calls } = twoTableDouble();
    from.mockImplementation((table: string) => builderFor(table));

    await expect(sendInvites(null, formData(inviteFields))).rejects.toThrow(/NEXT_REDIRECT/);

    const partnerUpdates = calls.update.filter((u) => u.table === 'event_partners');
    expect(partnerUpdates).toHaveLength(2);
    // Only the two granted columns. event_id and user_id must never appear.
    for (const update of partnerUpdates) {
      expect(Object.keys(update.payload).sort()).toEqual(['display_name', 'invite_email']);
    }
  });

  test('promotes only a draft', async () => {
    const { builderFor, calls } = twoTableDouble();
    from.mockImplementation((table: string) => builderFor(table));

    await expect(sendInvites(null, formData(inviteFields))).rejects.toThrow(/NEXT_REDIRECT/);

    const promotion = calls.update.find((u) => u.table === 'events');
    expect(promotion?.payload).toEqual({ status: 'upcoming' });
    // Without this, opening this URL on a finished wedding drags a completed
    // event back to 'upcoming' and it reappears on the dashboard (design §5.2).
    expect(promotion?.eq).toContainEqual(['status', 'draft']);
    expect(promotion?.eq).toContainEqual(['id', EVENT_ID]);
  });

  test('redirects to the confirmation', async () => {
    const { builderFor } = twoTableDouble();
    from.mockImplementation((table: string) => builderFor(table));

    await expect(sendInvites(null, formData(inviteFields))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirect).toHaveBeenCalledWith(`/events/new/${EVENT_ID}/sent`);
  });

  test('stops at the partner write when it fails, and never promotes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { builderFor, calls } = twoTableDouble({
      partnersError: { code: '42501', message: 'denied' },
    });
    from.mockImplementation((table: string) => builderFor(table));

    const result = await sendInvites(null, formData(inviteFields));

    expect(result).toEqual({ ok: false, message: 'Could not save that. Try again.' });
    expect(calls.update.find((u) => u.table === 'events')).toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
    error.mockRestore();
  });

  test('rejects an invalid email without touching the database', async () => {
    const result = await sendInvites(null, formData({ ...inviteFields, email2: 'nope' }));

    expect(result).toMatchObject({ ok: false });
    expect(from).not.toHaveBeenCalled();
  });
});
