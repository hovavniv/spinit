import { it, expect, vi, beforeEach, describe } from 'vitest';
import type { LiveState } from '@/lib/live/liveDal';
import type { ActivityItem, QueueSuggestion } from '@/lib/live/liveTypes';
import { UNRESOLVABLE_TRACK_TITLE } from '@/lib/live/liveTypes';
import type { ResolvedTrack, ResolveTracksResult } from '@/lib/spotify/tracks';

// Every collaborator the route has, mocked at the module boundary. Declared
// with vi.hoisted so the vi.mock factories below can close over them, same
// pattern as enrich-next/route.test.ts.
const { requireUser, createClient, readLiveState, readActivity, resolveTracks, from, eventsSelect, eventsEq, eventsMaybeSingle, upsert } =
  vi.hoisted(() => ({
    requireUser: vi.fn(async () => ({ id: 'u-dj-1' })),
    createClient: vi.fn(),
    readLiveState: vi.fn(),
    readActivity: vi.fn(async (): Promise<ActivityItem[]> => []),
    resolveTracks: vi.fn(
      async (_ids: string[], _opts?: { max?: number; concurrency?: number }): Promise<ResolveTracksResult> => ({
        resolved: [],
        notFound: [],
      }),
    ),
    from: vi.fn(),
    eventsSelect: vi.fn(),
    eventsEq: vi.fn(),
    eventsMaybeSingle: vi.fn(),
    upsert: vi.fn(async (_row: unknown, _opts?: unknown) => ({ data: null, error: null })),
  }));

vi.mock('@/lib/auth/dal', () => ({ requireUser }));
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/live/liveDal', () => ({ readLiveState, readActivity }));
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
  resolveTracks.mockResolvedValue({ resolved: [], notFound: [] });
  readLiveState.mockResolvedValue(baseLiveState());
  readActivity.mockResolvedValue([]);

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
    resolveTracks.mockResolvedValue({
      resolved: [
        { id: 't-2', title: 'Unresolved Song', artist: 'Unresolved Artist', artists: [{ id: 'a-2', name: 'Unresolved Artist' }] },
      ],
      notFound: [],
    });

    const res = await GET(req(), params(EVENT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('queue');
    expect(body).toHaveProperty('blocked');
    // readActivity is mocked to resolve [] by default in this file's own
    // beforeEach -- this asserts the route's OWN wiring passes that mocked
    // result through untouched, not that readActivity itself returns [].
    // readActivity's real behaviour is pinned in liveDal's own test file.
    expect(body.activity).toEqual([]);
    expect(body).toHaveProperty('mustPlayProgress');
    expect(body).toHaveProperty('unresolvedArtistIds');
    expect(body).toHaveProperty('now');
    expect(Array.isArray(body.queue)).toBe(true);
    expect(body.queue.length).toBe(2);
  });

  it('passes readActivity\'s result through as the response\'s activity field, by event id', async () => {
    const activity = [
      {
        id: 'requested-s1',
        verb: 'requested' as const,
        guestName: 'Noa',
        title: 'September',
        artist: 'Earth, Wind & Fire',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    readActivity.mockResolvedValue(activity);

    const res = await GET(req(), params(EVENT_ID));
    const body = await res.json();

    expect(body.activity).toEqual(activity);
    expect(readActivity).toHaveBeenCalledWith(EVENT_ID);
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
    resolveTracks.mockResolvedValue({
      resolved: [
        { id: 't-2', title: 'Unresolved Song', artist: 'Unresolved Artist', artists: [{ id: 'a-2', name: 'Unresolved Artist' }] },
      ],
      notFound: [],
    });

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

  describe('F1: a track id Spotify 404s must not occupy a resolution slot forever', () => {
    // Guest-suggested spotify_track_id shapes don't matter to this test --
    // only their identity does, so short readable literals stand in for the
    // real ^[A-Za-z0-9]{22}$ ids.
    const REAL_1 = 't-real-1';
    const NOT_FOUND = 't-not-found';
    const REAL_2 = 't-real-2';

    // A tiny in-memory stand-in for spotify_tracks/spotify_track_artists,
    // written to by the route's own upsert calls and read back by
    // readLiveState's mock -- this is what lets the test observe the SAME
    // starvation the real database would produce across repeated polls,
    // without a live database.
    let trackStore: Map<string, { title: string; artist: string }>;
    let artistStore: Map<string, string[]>;

    function suggestionsNow(): QueueSuggestion[] {
      return [REAL_1, NOT_FOUND, REAL_2].map((trackId, i) => {
        const resolved = trackStore.get(trackId);
        return {
          id: `s-${trackId}`,
          spotifyTrackId: trackId,
          title: `Guest title ${i}`,
          artist: `Guest artist ${i}`,
          resolvedTitle: resolved?.title ?? null,
          resolvedArtist: resolved?.artist ?? null,
          artistIds: artistStore.get(trackId) ?? [],
          requesters: 1,
          createdAt: `2026-01-01T00:0${i}:00.000Z`,
          suggestedByName: 'Guest',
        };
      });
    }

    beforeEach(() => {
      trackStore = new Map();
      artistStore = new Map();

      const trackUpsert = vi.fn(async (row: { spotify_track_id: string; title: string; artist: string }) => {
        trackStore.set(row.spotify_track_id, { title: row.title, artist: row.artist });
        return { data: null, error: null };
      });
      const artistUpsert = vi.fn(
        async (rows: { spotify_track_id: string; spotify_artist_id: string }[]) => {
          for (const row of rows) {
            const list = artistStore.get(row.spotify_track_id) ?? [];
            list.push(row.spotify_artist_id);
            artistStore.set(row.spotify_track_id, list);
          }
          return { data: null, error: null };
        },
      );

      from.mockImplementation((table: string) => {
        if (table === 'events') return eventsTable({ id: EVENT_ID, dj_id: 'u-dj-1', status: 'live' });
        if (table === 'spotify_tracks') return { upsert: trackUpsert };
        if (table === 'spotify_track_artists') return { upsert: artistUpsert };
        throw new Error(`unexpected table ${table}`);
      });

      readLiveState.mockImplementation(async () => baseLiveState({ suggestions: suggestionsNow() }));

      // A fixture stand-in for the real resolveTracks. The route itself
      // still calls resolveTracks with `{ max: 10 }` -- that was never
      // changed. This mock's `max` of 1 is a simulation choice made only in
      // this test's own fixture, so it can force a bounded budget across
      // repeated polls without waiting for ten real suggestions; it applies
      // oldest-first over whatever ids the route still considers unresolved,
      // the same slicing real resolveTracks does internally, just without a
      // live Spotify call.
      resolveTracks.mockImplementation(async (ids: string[]): Promise<ResolveTracksResult> => {
        const targets = ids.slice(0, 1);
        const resolved: ResolvedTrack[] = [];
        const notFound: string[] = [];
        for (const trackId of targets) {
          if (trackId === NOT_FOUND) {
            notFound.push(trackId);
          } else {
            resolved.push({
              id: trackId,
              title: `Resolved ${trackId}`,
              artist: 'Some Artist',
              artists: [{ id: `artist-${trackId}`, name: 'Some Artist' }],
            });
          }
        }
        return { resolved, notFound };
      });
    });

    it('resolves both real tracks within a bounded number of polls, and marks the 404 unresolvable rather than leaving it silently pending', async () => {
      // Poll 1: real1 sits first in suggestion order, so it is the one
      // attempt this poll's max-of-1 budget allows.
      await GET(req(), params(EVENT_ID));
      expect(artistStore.has(REAL_1)).toBe(true);

      // Poll 2: real1 has left `unresolvedTrackIds` (its spotify_tracks row
      // now exists), so the 404 id is next in line and consumes this poll's
      // one attempt -- and, under the fix, is marked unresolvable rather
      // than silently dropped.
      const res2 = await GET(req(), params(EVENT_ID));
      const body2 = await res2.json();
      expect(trackStore.get(NOT_FOUND)?.title).toBe(UNRESOLVABLE_TRACK_TITLE);
      const notFoundRow = body2.queue.find(
        (r: { suggestion: { spotifyTrackId: string } }) => r.suggestion.spotifyTrackId === NOT_FOUND,
      );
      expect(notFoundRow.reasons.some((r: { kind: string }) => r.kind === 'unresolvable')).toBe(true);

      // Poll 3: the 404 id has left `unresolvedTrackIds` for good (it has a
      // spotify_tracks row now, sentinel or not), freeing the single slot
      // for real2 -- the crux of the fix. Before the fix, the 404 id's
      // artistIds never left `[]`, so it kept re-winning this same slot on
      // every poll and real2 was NEVER attempted, for ever.
      const res3 = await GET(req(), params(EVENT_ID));
      const body3 = await res3.json();
      expect(artistStore.has(REAL_2)).toBe(true);
      const real1Row = body3.queue.find(
        (r: { suggestion: { spotifyTrackId: string } }) => r.suggestion.spotifyTrackId === REAL_1,
      );
      const real2Row = body3.queue.find(
        (r: { suggestion: { spotifyTrackId: string } }) => r.suggestion.spotifyTrackId === REAL_2,
      );
      expect(real1Row.suggestion.artistIds.length).toBeGreaterThan(0);
      expect(real2Row.suggestion.artistIds.length).toBeGreaterThan(0);
    });
  });

  describe('G1: a failed spotify_track_artists upsert must not permanently disable retries', () => {
    // A single track: its spotify_tracks row lands successfully, but its
    // spotify_track_artists upsert fails on the FIRST poll and succeeds on
    // the SECOND. Under the pre-fix `resolvedTitle === null` predicate, once
    // the spotify_tracks row lands `resolvedTitle` is non-null for ever, so
    // the track never re-enters `unresolvedTrackIds` and `artistIds` stays
    // `[]` permanently -- this test pins that it is retried instead.
    const TRACK_ID = 't-artist-upsert-flaky';

    let trackStore: Map<string, { title: string; artist: string }>;
    let artistStore: Map<string, string[]>;
    let artistUpsertCallCount: number;

    function suggestionNow(): QueueSuggestion {
      const resolved = trackStore.get(TRACK_ID);
      return {
        id: `s-${TRACK_ID}`,
        spotifyTrackId: TRACK_ID,
        title: 'Guest title',
        artist: 'Guest artist',
        resolvedTitle: resolved?.title ?? null,
        resolvedArtist: resolved?.artist ?? null,
        artistIds: artistStore.get(TRACK_ID) ?? [],
        requesters: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        suggestedByName: 'Guest',
      };
    }

    beforeEach(() => {
      trackStore = new Map();
      artistStore = new Map();
      artistUpsertCallCount = 0;

      const trackUpsert = vi.fn(async (row: { spotify_track_id: string; title: string; artist: string }) => {
        trackStore.set(row.spotify_track_id, { title: row.title, artist: row.artist });
        return { data: null, error: null };
      });
      // Fails on its first invocation (poll 1), succeeds on every subsequent
      // one (poll 2+) -- simulating a transient write failure.
      const artistUpsert = vi.fn(
        async (rows: { spotify_track_id: string; spotify_artist_id: string }[]) => {
          artistUpsertCallCount += 1;
          if (artistUpsertCallCount === 1) {
            return { data: null, error: { message: 'simulated transient failure' } };
          }
          for (const row of rows) {
            const list = artistStore.get(row.spotify_track_id) ?? [];
            list.push(row.spotify_artist_id);
            artistStore.set(row.spotify_track_id, list);
          }
          return { data: null, error: null };
        },
      );

      from.mockImplementation((table: string) => {
        if (table === 'events') return eventsTable({ id: EVENT_ID, dj_id: 'u-dj-1', status: 'live' });
        if (table === 'spotify_tracks') return { upsert: trackUpsert };
        if (table === 'spotify_track_artists') return { upsert: artistUpsert };
        throw new Error(`unexpected table ${table}`);
      });

      readLiveState.mockImplementation(async () => baseLiveState({ suggestions: [suggestionNow()] }));

      resolveTracks.mockImplementation(async (ids: string[]): Promise<ResolveTracksResult> => ({
        resolved: ids.map((trackId) => ({
          id: trackId,
          title: `Resolved ${trackId}`,
          artist: 'Some Artist',
          artists: [{ id: `artist-${trackId}`, name: 'Some Artist' }],
        })),
        notFound: [],
      }));
    });

    it('retries the artist upsert next poll after a failure, and artistIds populates once it succeeds', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Poll 1: spotify_tracks upsert succeeds, spotify_track_artists upsert
      // fails. The failed write must not be reported as resolved this poll.
      const res1 = await GET(req(), params(EVENT_ID));
      const body1 = await res1.json();
      expect(artistStore.has(TRACK_ID)).toBe(false);
      expect(trackStore.has(TRACK_ID)).toBe(true);
      const row1 = body1.queue.find(
        (r: { suggestion: { spotifyTrackId: string } }) => r.suggestion.spotifyTrackId === TRACK_ID,
      );
      expect(row1.suggestion.artistIds).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'state poll: spotify_track_artists upsert failed',
        expect.objectContaining({ trackId: TRACK_ID }),
      );

      // Poll 2: the track now has a spotify_tracks row but no artist rows --
      // under the fix's predicate this is still "unresolved" and is retried.
      // This time the artist upsert succeeds.
      const res2 = await GET(req(), params(EVENT_ID));
      const body2 = await res2.json();
      expect(artistStore.has(TRACK_ID)).toBe(true);
      const row2 = body2.queue.find(
        (r: { suggestion: { spotifyTrackId: string } }) => r.suggestion.spotifyTrackId === TRACK_ID,
      );
      expect(row2.suggestion.artistIds.length).toBeGreaterThan(0);

      consoleErrorSpy.mockRestore();
    });
  });

  // G5: F5's spotify_tracks upsert error check was previously unexercised --
  // every existing fixture in this file returns `{ error: null }`, so
  // deleting the `if (trackUpsert.error) { continue }` branch would leave
  // the whole suite green. This is the close sibling the fix-spec allows
  // for, covering the OTHER upsert (the parent row, not the artist rows).
  describe('G5: a failed spotify_tracks upsert must not be reported as resolved', () => {
    const TRACK_ID = 't-track-upsert-flaky';

    it('leaves the track unresolved in this poll\'s response and logs the error, rather than reporting success', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const trackUpsert = vi.fn(async () => ({ data: null, error: { message: 'simulated write failure' } }));
      const artistUpsert = vi.fn(async () => ({ data: null, error: null }));

      from.mockImplementation((table: string) => {
        if (table === 'events') return eventsTable({ id: EVENT_ID, dj_id: 'u-dj-1', status: 'live' });
        if (table === 'spotify_tracks') return { upsert: trackUpsert };
        if (table === 'spotify_track_artists') return { upsert: artistUpsert };
        throw new Error(`unexpected table ${table}`);
      });

      readLiveState.mockResolvedValue(
        baseLiveState({
          suggestions: [
            {
              id: `s-${TRACK_ID}`,
              spotifyTrackId: TRACK_ID,
              title: 'Guest title',
              artist: 'Guest artist',
              resolvedTitle: null,
              resolvedArtist: null,
              artistIds: [],
              requesters: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              suggestedByName: 'Guest',
            },
          ],
        }),
      );
      resolveTracks.mockResolvedValue({
        resolved: [
          { id: TRACK_ID, title: 'Resolved Title', artist: 'Resolved Artist', artists: [{ id: 'a-x', name: 'Resolved Artist' }] },
        ],
        notFound: [],
      });

      const res = await GET(req(), params(EVENT_ID));
      const body = await res.json();

      expect(artistUpsert).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'state poll: spotify_tracks upsert failed',
        expect.objectContaining({ trackId: TRACK_ID }),
      );
      const row = body.queue.find(
        (r: { suggestion: { spotifyTrackId: string } }) => r.suggestion.spotifyTrackId === TRACK_ID,
      );
      expect(row.suggestion.resolvedTitle).toBeNull();
      expect(row.suggestion.artistIds).toEqual([]);

      consoleErrorSpy.mockRestore();
    });
  });
});
