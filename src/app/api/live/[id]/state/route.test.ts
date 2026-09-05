import { it, expect, vi, beforeEach, describe } from 'vitest';
import type { LiveState } from '@/lib/live/liveDal';
import type { ResolvedTrack } from '@/lib/spotify/tracks';

// Every collaborator the route has, mocked at the module boundary. Declared
// with vi.hoisted so the vi.mock factories below can close over them, same
// pattern as enrich-next/route.test.ts.
const { requireUser, createClient, readLiveState, resolveTracks, from, eventsSelect, eventsEq, eventsMaybeSingle, upsert } =
  vi.hoisted(() => ({
    requireUser: vi.fn(async () => ({ id: 'u-dj-1' })),
    createClient: vi.fn(),
    readLiveState: vi.fn(),
    resolveTracks: vi.fn(async (_ids: string[], _opts?: { max?: number; concurrency?: number }): Promise<ResolvedTrack[]> => []),
    from: vi.fn(),
    eventsSelect: vi.fn(),
    eventsEq: vi.fn(),
    eventsMaybeSingle: vi.fn(),
    upsert: vi.fn(async (_row: unknown, _opts?: unknown) => ({ data: null, error: null })),
  }));

vi.mock('@/lib/auth/dal', () => ({ requireUser }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/live/liveDal', () => ({ readLiveState }));
vi.mock('@/lib/spotify/tracks', () => ({ resolveTracks }));

import { GET } from './route';

const EVENT_ID = '3f0c1a5e-8b2d-4f6a-9c1e-2d4b6a8c0e2f';

function eventsTable(row: { id: string; dj_id: string; status: string } | null) {
  eventsMaybeSingle.mockResolvedValue({ data: row, error: null });
  eventsEq.mockReturnValue({ maybeSingle: eventsMaybeSingle });
  eventsSelect.mockReturnValue({ eq: eventsEq });
  return { select: eventsSelect };
}

function baseLiveState(overrides: Partial<LiveState> = {}): LiveState {
  return {
    event: { id: EVENT_ID, phase: 'open-floor', phaseStartedAt: null },
    mustPlay: [],
    blocklist: [],
    played: [],
    suggestions: [],
    genresByArtistId: {},
    ...overrides,
  };
}

function req() {
  return new Request(`http://localhost/api/live/${EVENT_ID}/state`);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: 'u-dj-1' });
  resolveTracks.mockResolvedValue([]);
  readLiveState.mockResolvedValue(baseLiveState());

  from.mockImplementation((table: string) => {
    if (table === 'events') return eventsTable({ id: EVENT_ID, dj_id: 'u-dj-1', status: 'live' });
    if (table === 'spotify_tracks') return { upsert };
    if (table === 'spotify_track_artists') return { upsert };
    throw new Error(`unexpected table ${table}`);
  });

  createClient.mockResolvedValue({ from });
});

describe('GET /api/live/[id]/state', () => {
  it('404s for a non-uuid id, before any query', async () => {
    const res = await GET(req(), params('not-a-uuid'));
    expect(res.status).toBe(404);
    expect(requireUser).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('404s for a partner (event exists, dj_id !== user.id), not 403', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'events') return eventsTable({ id: EVENT_ID, dj_id: 'someone-else', status: 'live' });
      throw new Error(`unexpected table ${table}`);
    });
    const res = await GET(req(), params(EVENT_ID));
    expect(res.status).toBe(404);
  });

  it('404s for an event that is not live', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'events') return eventsTable({ id: EVENT_ID, dj_id: 'u-dj-1', status: 'upcoming' });
      throw new Error(`unexpected table ${table}`);
    });
    const res = await GET(req(), params(EVENT_ID));
    expect(res.status).toBe(404);
  });

  it('404s for no such event', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'events') return eventsTable(null);
      throw new Error(`unexpected table ${table}`);
    });
    const res = await GET(req(), params(EVENT_ID));
    expect(res.status).toBe(404);
  });

  it('happy path: returns queue, blocked, activity, mustPlayProgress, unresolvedArtistIds, now', async () => {
    readLiveState.mockResolvedValue(
      baseLiveState({
        suggestions: [
          {
            id: 's-resolved',
            spotifyTrackId: 't-1',
            title: 'Resolved Song',
            artist: 'Resolved Artist',
            resolvedTitle: null,
            resolvedArtist: null,
            artistIds: ['a-1'],
            requesters: 2,
            createdAt: '2026-01-01T00:00:00.000Z',
            suggestedByName: 'Alex',
          },
          {
            id: 's-unresolved',
            spotifyTrackId: 't-2',
            title: 'Unresolved Song',
            artist: 'Unresolved Artist',
            resolvedTitle: null,
            resolvedArtist: null,
            artistIds: [],
            requesters: 1,
            createdAt: '2026-01-01T00:01:00.000Z',
            suggestedByName: 'Sam',
          },
        ],
      }),
    );
    resolveTracks.mockResolvedValue([
      { id: 't-2', title: 'Unresolved Song', artist: 'Unresolved Artist', artists: [{ id: 'a-2', name: 'Unresolved Artist' }] },
    ]);

    const res = await GET(req(), params(EVENT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('queue');
    expect(body).toHaveProperty('blocked');
    expect(body.activity).toEqual([]);
    expect(body).toHaveProperty('mustPlayProgress');
    expect(body).toHaveProperty('unresolvedArtistIds');
    expect(body).toHaveProperty('now');
    expect(Array.isArray(body.queue)).toBe(true);
    expect(body.queue.length).toBe(2);
  });

  it('returns played, so CeremonyCues and CoupleRules can turn a row green without a page refresh', async () => {
    readLiveState.mockResolvedValue(
      baseLiveState({
        played: [{ position: 1, spotifyTrackId: 't-played-1', artistIds: [] }],
      }),
    );

    const res = await GET(req(), params(EVENT_ID));
    const body = await res.json();

    expect(body.played).toEqual([{ position: 1, spotifyTrackId: 't-played-1', artistIds: [] }]);
  });

  it('never includes the raw blocklist or genresByArtistId at the top level', async () => {
    readLiveState.mockResolvedValue(
      baseLiveState({
        blocklist: [
          { id: 'b-1', segment: 'party', entry_type: 'artist', value: 'Bad Artist', spotify_id: 'a-bad', created_at: '2026-01-01T00:00:00.000Z' },
        ],
        genresByArtistId: { 'a-1': { pop: 1 } },
      }),
    );

    const res = await GET(req(), params(EVENT_ID));
    const body = await res.json();
    expect(Object.keys(body)).not.toContain('blocklist');
    expect(Object.keys(body)).not.toContain('genresByArtistId');
  });

  it('mustPlayProgress counts all segments, not just the current phase', async () => {
    readLiveState.mockResolvedValue(
      baseLiveState({
        event: { id: EVENT_ID, phase: 'open-floor', phaseStartedAt: null }, // segment: party
        mustPlay: [
          { id: 'mp-1', segment: 'reception', title: 'Reception Song', artist: 'X', moment: null, spotify_track_id: 't-played-1', spotify_artist_id: null, created_at: '2026-01-01T00:00:00.000Z' },
          { id: 'mp-2', segment: 'party', title: 'Party Song', artist: 'Y', moment: null, spotify_track_id: 't-played-2', spotify_artist_id: null, created_at: '2026-01-01T00:00:00.000Z' },
        ],
        played: [
          { position: 1, spotifyTrackId: 't-played-1', artistIds: [] },
          { position: 2, spotifyTrackId: 't-played-2', artistIds: [] },
        ],
      }),
    );

    const res = await GET(req(), params(EVENT_ID));
    const body = await res.json();
    expect(body.mustPlayProgress).toEqual({ played: 2, total: 2 });
  });

  it('a track resolved this poll appears ranked (not genre-pending) in the same response', async () => {
    readLiveState.mockResolvedValue(
      baseLiveState({
        genresByArtistId: { 'a-2': { pop: 3 } },
        suggestions: [
          {
            id: 's-unresolved',
            spotifyTrackId: 't-2',
            title: 'Unresolved Song',
            artist: 'Unresolved Artist',
            resolvedTitle: null,
            resolvedArtist: null,
            artistIds: [],
            requesters: 1,
            createdAt: '2026-01-01T00:01:00.000Z',
            suggestedByName: 'Sam',
          },
        ],
      }),
    );
    resolveTracks.mockResolvedValue([
      { id: 't-2', title: 'Unresolved Song', artist: 'Unresolved Artist', artists: [{ id: 'a-2', name: 'Unresolved Artist' }] },
    ]);

    const res = await GET(req(), params(EVENT_ID));
    const body = await res.json();
    const row = body.queue.find((r: { suggestion: { id: string } }) => r.suggestion.id === 's-unresolved');
    expect(row).toBeDefined();
    expect(row.reasons.some((r: { kind: string }) => r.kind === 'genre-pending')).toBe(false);
  });

  it('unresolvedArtistIds excludes artists that already have a genresByArtistId entry, including an empty one', async () => {
    readLiveState.mockResolvedValue(
      baseLiveState({
        genresByArtistId: { 'a-checked-empty': {} },
        suggestions: [
          {
            id: 's-1',
            spotifyTrackId: 't-1',
            title: 'Song 1',
            artist: 'Artist 1',
            resolvedTitle: null,
            resolvedArtist: null,
            artistIds: ['a-checked-empty', 'a-unresolved'],
            requesters: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            suggestedByName: 'Alex',
          },
        ],
      }),
    );

    const res = await GET(req(), params(EVENT_ID));
    const body = await res.json();
    expect(body.unresolvedArtistIds).toEqual(['a-unresolved']);
  });
});
