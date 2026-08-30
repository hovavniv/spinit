import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ---------------------------------------------------------------------------
   The two note writes (design §3, §5.2).

   The assertions that matter here are the two the design calls out by name:
   the write is an UPSERT rather than an UPDATE, and the two actions address
   two different tables. Both are shapes a refactor can silently break without
   any type error -- `.update()` compiles exactly as well as `.upsert()`.
   --------------------------------------------------------------------------- */

const upsert = vi.fn();
const from = vi.fn(() => ({ upsert }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from })),
}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { savePrivateNotes, saveSharedNotes } from './notesActions';

const EVENT = '11111111-1111-4111-8111-111111111111';

function form(body: string, eventId = EVENT) {
  const formData = new FormData();
  formData.set('eventId', eventId);
  formData.set('body', body);
  return formData;
}

beforeEach(() => {
  upsert.mockReset();
  from.mockClear();
  upsert.mockResolvedValue({ error: null });
});

describe('savePrivateNotes', () => {
  it('UPSERTS rather than updates', async () => {
    // An update against an event with no note row returns success having
    // written nothing. The migration backfills a row per event, so an update
    // would work today and break for the first event created after it.
    await savePrivateNotes(null, form('hello'));

    expect(upsert).toHaveBeenCalledWith(
      { event_id: EVENT, body: 'hello' },
      { onConflict: 'event_id' },
    );
  });

  it('writes the private table', async () => {
    await savePrivateNotes(null, form('hello'));

    expect(from).toHaveBeenCalledWith('event_private_notes');
  });

  it('returns a field error for an over-long body without touching the database', async () => {
    const result = await savePrivateNotes(null, form('x'.repeat(2001)));

    expect(result).toEqual({ ok: false, formErrors: { body: expect.any(String) } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns a generic message on a database error and does not leak it', async () => {
    upsert.mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });

    const result = await savePrivateNotes(null, form('hi'));

    expect(result).toEqual({ ok: false, message: expect.not.stringContaining('permission') });
  });
});

describe('saveSharedNotes', () => {
  it('writes the shared table', async () => {
    await saveSharedNotes(null, form('both of us'));

    expect(from).toHaveBeenCalledWith('event_shared_notes');
  });

  it('upserts the same shape as the private one', async () => {
    await saveSharedNotes(null, form('both of us'));

    expect(upsert).toHaveBeenCalledWith(
      { event_id: EVENT, body: 'both of us' },
      { onConflict: 'event_id' },
    );
  });
});
