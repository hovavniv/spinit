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
  removeBlocklistEntry,
  saveEventDetails,
  endEvent,
} from './detailActions';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';
const ROW_ID = '99999999-2222-4333-8444-555555555555';

/** Real Spotify ids are 22 base62 characters. Distinct per fixture on purpose. */
const TRACK_ID_A = 'aaaaaaaaaaaaaaaaaaaaaa';
const ARTIST_ID_A = 'bbbbbbbbbbbbbbbbbbbbbb';
const TRACK_ID_B = 'cccccccccccccccccccccc';
const ARTIST_ID_B = 'dddddddddddddddddddddd';

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/**
 * A `from()` double whose insert/update/delete resolve to `result`.
 *
 * `data` defaults to a single placeholder row, not `[]`: `saveEventDetails`'s
 * update/delete branches now call `.select()` and treat a zero-row result as
 * a failure (the repo's documented silent-zero-row shape), so a double with
 * no `data` at all would make every existing update/delete test fail for a
 * reason unrelated to what it pins. Tests that specifically exercise the
 * zero-row path pass `data: []` explicitly.
 */
function tableDouble(result: {
  error: { code?: string; message: string } | null;
  data?: unknown[] | null;
}) {
  const resolved = { data: result.data ?? [{ id: 'row-1' }], error: result.error };
  const insert = vi.fn().mockResolvedValue(resolved);
  const eq = vi.fn().mockReturnThis();
  const builder = {
    insert,
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq,
    in: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => void) => resolve(resolved),
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
      spotifyTrackId: TRACK_ID_A,
      spotifyArtistId: ARTIST_ID_A,
    }));

    expect(result).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('event_must_play');
    expect(table.insert).toHaveBeenCalledWith({
      event_id: EVENT_ID,
      segment: 'party',
      title: 'September',
      artist: 'Earth, Wind & Fire',
      moment: null,
      spotify_track_id: TRACK_ID_A,
      spotify_artist_id: ARTIST_ID_A,
    });
    // The literal path, never '/events/[id]' — that form silently no-ops.
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT_ID}`);
  });

  test('inserts null, not empty string, when no artist id was picked', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    await addMustPlay(null, formData({
      eventId: EVENT_ID,
      segment: 'party',
      title: 'September',
      artist: '',
      moment: '',
      spotifyTrackId: TRACK_ID_A,
    }));

    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({ spotify_artist_id: null }),
    );
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
      spotifyTrackId: TRACK_ID_A,
    }));

    expect(result.ok).toBe(false);
    expect(table.insert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test('returns a field error and writes nothing when no track was picked', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await addMustPlay(null, formData({
      eventId: EVENT_ID,
      segment: 'party',
      title: 'September',
      artist: '',
      moment: '',
    }));

    expect(result.ok).toBe(false);
    expect(table.insert).not.toHaveBeenCalled();
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
      spotifyTrackId: TRACK_ID_A,
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
      spotifyId: ARTIST_ID_A,
    }));

    expect(result).toEqual({
      ok: false,
      formErrors: { value: 'Already on the do-not-play list.' },
    });
  });

  test('writes the picked id for an artist entry', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    await addBlocklistEntry(null, formData({
      eventId: EVENT_ID,
      segment: 'party',
      entryType: 'artist',
      value: 'Nickelback',
      spotifyId: ARTIST_ID_A,
    }));

    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({ entry_type: 'artist', spotify_id: ARTIST_ID_A }),
    );
  });

  test('writes null spotify_id for a genre entry even if one was somehow sent', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await addBlocklistEntry(null, formData({
      eventId: EVENT_ID,
      segment: 'party',
      entryType: 'genre',
      value: 'disco',
    }));

    expect(result).toEqual({ ok: true });
    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({ entry_type: 'genre', spotify_id: null }),
    );
  });

  test('rejects an artist entry with no spotify id before it reaches the database', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await addBlocklistEntry(null, formData({
      eventId: EVENT_ID,
      segment: 'party',
      entryType: 'artist',
      value: 'Nickelback',
    }));

    expect(result.ok).toBe(false);
    expect(table.insert).not.toHaveBeenCalled();
  });
});

describe('removeMustPlay', () => {
  test('deletes by id scoped to the event, then revalidates', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await removeMustPlay(formData({ id: ROW_ID, eventId: EVENT_ID }));

    expect(table.delete).toHaveBeenCalled();
    expect(table.select).toHaveBeenCalled();
    expect(table.eq).toHaveBeenCalledWith('id', ROW_ID);
    expect(table.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT_ID}`);
    expect(result).toEqual({ ok: true });
  });

  test('reports a failure, rather than success, when the delete matches no row', async () => {
    // The repo's documented silent-zero-row shape: a policy-filtered or
    // nonexistent id/eventId still returns success having deleted nothing
    // without the .select() check below.
    const table = tableDouble({ error: null, data: [] });
    from.mockReturnValue(table);

    const result = await removeMustPlay(formData({ id: ROW_ID, eventId: EVENT_ID }));

    expect(result).toEqual({ ok: false, message: 'Could not save that. Try again.' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test('succeeds when exactly one row is deleted', async () => {
    const table = tableDouble({ error: null, data: [{ id: ROW_ID }] });
    from.mockReturnValue(table);

    await expect(removeMustPlay(formData({ id: ROW_ID, eventId: EVENT_ID }))).resolves.toEqual({
      ok: true,
    });
  });
});

describe('removeBlocklistEntry', () => {
  test('deletes by id scoped to the event, then revalidates', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await removeBlocklistEntry(formData({ id: ROW_ID, eventId: EVENT_ID }));

    expect(table.delete).toHaveBeenCalled();
    expect(table.select).toHaveBeenCalled();
    expect(table.eq).toHaveBeenCalledWith('id', ROW_ID);
    expect(table.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT_ID}`);
    expect(result).toEqual({ ok: true });
  });

  test('reports a failure, rather than success, when the delete matches no row', async () => {
    const table = tableDouble({ error: null, data: [] });
    from.mockReturnValue(table);

    const result = await removeBlocklistEntry(formData({ id: ROW_ID, eventId: EVENT_ID }));

    expect(result).toEqual({ ok: false, message: 'Could not save that. Try again.' });
    expect(revalidatePath).not.toHaveBeenCalled();
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
      'ceremony-0-spotifyTrackId': TRACK_ID_A,
      'ceremony-0-spotifyArtistId': ARTIST_ID_A,
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

  test('the ceremony UPDATE branch carries the track id, not just the title', async () => {
    // The quieter half of the split: today it would write only { title,
    // artist }. A DJ picking a different song must not leave the title
    // changed while the id still points at the ORIGINAL pick.
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    await saveEventDetails(null, formData({
      eventId: EVENT_ID,
      'ceremony-0-id': ROW_ID,
      'ceremony-0-title': 'Track B',
      'ceremony-0-artist': 'Artist B',
      'ceremony-0-spotifyTrackId': TRACK_ID_B,
      'ceremony-0-spotifyArtistId': ARTIST_ID_B,
      'ceremony-1-id': '',
      'ceremony-1-title': '',
      'ceremony-1-artist': '',
    }));

    expect(table.update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Track B',
        spotify_track_id: TRACK_ID_B,
        spotify_artist_id: ARTIST_ID_B,
      }),
    );
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
      'ceremony-0-spotifyTrackId': TRACK_ID_A,
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
      spotify_track_id: TRACK_ID_A,
      spotify_artist_id: null,
    });
  });

  test('the ceremony insert branch carries the track id', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    await saveEventDetails(null, formData({
      eventId: EVENT_ID,
      'ceremony-0-id': '',
      'ceremony-0-title': 'Hava Nagila',
      'ceremony-0-artist': 'Traditional',
      'ceremony-0-spotifyTrackId': TRACK_ID_A,
      'ceremony-1-id': '',
      'ceremony-1-title': '',
      'ceremony-1-artist': '',
    }));

    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({ spotify_track_id: TRACK_ID_A }),
    );
  });

  test('rejects a filled ceremony slot with no track id, before writing anything', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await saveEventDetails(null, formData({
      eventId: EVENT_ID,
      'ceremony-0-id': '',
      'ceremony-0-title': 'Hava Nagila',
      'ceremony-0-artist': 'Traditional',
      'ceremony-1-id': '',
      'ceremony-1-title': '',
      'ceremony-1-artist': '',
    }));

    expect(result.ok).toBe(false);
    expect(table.insert).not.toHaveBeenCalled();
  });

  test('returns { ok: true } and writes nothing when every ceremony slot is empty', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await saveEventDetails(null, formData({
      eventId: EVENT_ID,
      'ceremony-0-id': '',
      'ceremony-0-title': '',
      'ceremony-0-artist': '',
      'ceremony-1-id': '',
      'ceremony-1-title': '',
      'ceremony-1-artist': '',
    }));

    expect(result).toEqual({ ok: true });
    expect(from).not.toHaveBeenCalled();
  });

  test('fails, rather than reporting success, when the update matches zero rows', async () => {
    // A policy-filtered or nonexistent (id, eventId, segment) combination
    // returns success having written nothing without the .select() check --
    // the repo's documented silent-zero-row shape.
    const table = tableDouble({ error: null, data: [] });
    from.mockReturnValue(table);

    const result = await saveEventDetails(null, formData({
      eventId: EVENT_ID,
      'ceremony-0-id': ROW_ID,
      'ceremony-0-title': 'A Thousand Years',
      'ceremony-0-artist': 'Christina Perri',
      'ceremony-0-spotifyTrackId': TRACK_ID_A,
      'ceremony-1-id': '',
      'ceremony-1-title': '',
      'ceremony-1-artist': '',
    }));

    expect(result).toEqual({ ok: false, message: 'Could not save that. Try again.' });
  });

  test('fails, rather than reporting success, when the delete matches zero rows', async () => {
    const table = tableDouble({ error: null, data: [] });
    from.mockReturnValue(table);

    const result = await saveEventDetails(null, formData({
      eventId: EVENT_ID,
      'ceremony-0-id': ROW_ID,
      'ceremony-0-title': '   ',
      'ceremony-0-artist': '',
      'ceremony-1-id': '',
      'ceremony-1-title': '',
      'ceremony-1-artist': '',
    }));

    expect(result).toEqual({ ok: false, message: 'Could not save that. Try again.' });
  });
});

describe('endEvent', () => {
  test('completes the event, guarding the transition on both admitted statuses', async () => {
    const table = tableDouble({ error: null });
    from.mockReturnValue(table);

    const result = await endEvent(formData({ eventId: EVENT_ID }));

    expect(result).toEqual({ ok: true });
    expect(table.update).toHaveBeenCalledWith({ status: 'completed' });
    expect(table.eq).toHaveBeenCalledWith('id', EVENT_ID);
    // The guard, asserted by value. Naming both admitted statuses means a
    // later widening to 'draft' or 'completed' fails here rather than
    // silently turning this endpoint into a way to resurrect an event.
    expect(table.in).toHaveBeenCalledWith('status', ['upcoming', 'live']);
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith('/events/upcoming');
  });

  test('calls requireUser before parsing', async () => {
    await endEvent(formData({ eventId: 'not-a-uuid' }));
    expect(requireUser).toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  test('rejects a malformed event id without querying', async () => {
    const result = await endEvent(formData({ eventId: 'banana' }));
    expect(result).toMatchObject({ ok: false });
    expect(from).not.toHaveBeenCalled();
  });

  test('treats a guard-refused write as a failure, not a silent success', async () => {
    // data: [] is the shape of "the row existed but the status guard excluded
    // it" — an already-completed event, or another DJ's row filtered by the
    // policy's USING clause. Without .select() in the action this assertion
    // would pass no matter what the guard did.
    from.mockReturnValue(tableDouble({ error: null, data: [] }));

    const result = await endEvent(formData({ eventId: EVENT_ID }));

    expect(result).toMatchObject({ ok: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test('reports a database error without leaking it', async () => {
    from.mockReturnValue(tableDouble({ error: { code: '42501', message: 'denied' } }));

    const result = await endEvent(formData({ eventId: EVENT_ID }));

    expect(result).toMatchObject({ ok: false });
    expect(result).not.toMatchObject({ message: expect.stringContaining('denied') });
  });
});
