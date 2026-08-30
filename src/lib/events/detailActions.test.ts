import { describe, test, expect, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
const revalidatePath = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUser() }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));

import {
  addMustPlay,
  removeMustPlay,
  addBlocklistEntry,
  saveEventDetails,
} from './detailActions';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';
const ROW_ID = '99999999-2222-4333-8444-555555555555';

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** A `from()` double whose insert/update/delete resolve to `result`. */
function tableDouble(result: { error: { code?: string; message: string } | null }) {
  const insert = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnThis();
  const builder = {
    insert,
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq,
    then: (resolve: (value: unknown) => void) => resolve(result),
  };
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: 'dj-1' });
});

describe('addMustPlay', () => {
  test('inserts the trimmed row and revalidates the literal path', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await addMustPlay(null, formData({
      eventId: EVENT_ID,
      segment: 'party',
      title: '  September  ',
      artist: 'Earth, Wind & Fire',
      moment: '',
    }));

    expect(result).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('event_must_play');
    expect(table.insert).toHaveBeenCalledWith({
      event_id: EVENT_ID,
      segment: 'party',
      title: 'September',
      artist: 'Earth, Wind & Fire',
      moment: null,
    });
    // The literal path, never '/events/[id]' — that form silently no-ops.
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT_ID}`);
  });

  test('returns a field error and writes nothing when the title is blank', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await addMustPlay(null, formData({
      eventId: EVENT_ID,
      segment: 'party',
      title: '   ',
      artist: '',
      moment: '',
    }));

    expect(result.ok).toBe(false);
    expect(table.insert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test('requires a user before it parses anything', async () => {
    requireUser.mockRejectedValue(new Error('no session'));

    await expect(
      addMustPlay(null, formData({ eventId: EVENT_ID, segment: 'party', title: 'x' })),
    ).rejects.toThrow('no session');
    expect(from).not.toHaveBeenCalled();
  });

  test('maps a database error to a generic message', async () => {
    from.mockReturnValue(tableDouble({ error: { code: '42501', message: 'rls' } }));

    const result = await addMustPlay(null, formData({
      eventId: EVENT_ID,
      segment: 'party',
      title: 'September',
      artist: '',
      moment: '',
    }));

    expect(result).toEqual({ ok: false, message: 'Could not save that. Try again.' });
  });
});

describe('addBlocklistEntry', () => {
  test('turns a unique violation into the duplicate message', async () => {
    from.mockReturnValue(tableDouble({ error: { code: '23505', message: 'duplicate key' } }));

    const result = await addBlocklistEntry(null, formData({
      eventId: EVENT_ID,
      segment: 'party',
      entryType: 'artist',
      value: 'nickelback',
    }));

    expect(result).toEqual({
      ok: false,
      formErrors: { value: 'Already on the do-not-play list.' },
    });
  });
});

describe('removeMustPlay', () => {
  test('deletes by id scoped to the event, then revalidates', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    await removeMustPlay(formData({ id: ROW_ID, eventId: EVENT_ID }));

    expect(table.delete).toHaveBeenCalled();
    expect(table.eq).toHaveBeenCalledWith('id', ROW_ID);
    expect(table.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT_ID}`);
  });
});

describe('saveEventDetails', () => {
  test('updates a filled slot that already has a row', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await saveEventDetails(null, formData({
      eventId: EVENT_ID,
      'ceremony-0-id': ROW_ID,
      'ceremony-0-title': 'A Thousand Years',
      'ceremony-0-artist': 'Christina Perri',
      'ceremony-1-id': '',
      'ceremony-1-title': '',
      'ceremony-1-artist': '',
    }));

    expect(result).toEqual({ ok: true });
    // `events` is NOT touched any more: notes left that table for their own
    // two tables and their own two actions (design §3, §5.2).
    expect(from).not.toHaveBeenCalledWith('events');
    expect(from).toHaveBeenCalledWith('event_must_play');
    expect(table.update).toHaveBeenCalled();
    // Slot 1 is empty and has no row: nothing is inserted for it.
    expect(table.insert).not.toHaveBeenCalled();
  });

  test('deletes a slot cleared to empty', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    await saveEventDetails(null, formData({
      eventId: EVENT_ID,
      'ceremony-0-id': ROW_ID,
      'ceremony-0-title': '   ',
      'ceremony-0-artist': '',
      'ceremony-1-id': '',
      'ceremony-1-title': '',
      'ceremony-1-artist': '',
    }));

    expect(table.delete).toHaveBeenCalled();
  });

  test('inserts a slot filled for the first time, with the moment from CEREMONY_SLOTS', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    await saveEventDetails(null, formData({
      eventId: EVENT_ID,
      'ceremony-0-id': '',
      'ceremony-0-title': 'Hava Nagila',
      'ceremony-0-artist': 'Traditional',
      'ceremony-1-id': '',
      'ceremony-1-title': '',
      'ceremony-1-artist': '',
    }));

    expect(table.insert).toHaveBeenCalledWith({
      event_id: EVENT_ID,
      segment: 'ceremony',
      moment: 'Walking down the aisle',
      title: 'Hava Nagila',
      artist: 'Traditional',
    });
  });
});
