import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireUser = vi.fn();
const maybeSingle = vi.fn();
const rpc = vi.fn();
const enrichArtist = vi.fn();

vi.mock('@/lib/auth/dal', () => ({ requireUser: () => requireUser() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    rpc: (...args: [string, unknown]) => rpc(...args),
  }),
}));
vi.mock('@/lib/genres/enrich', () => ({ enrichArtist: (...args: unknown[]) => enrichArtist(...args) }));
vi.mock('@/lib/genres/musicbrainz', () => ({
  mbidForSpotifyArtist: vi.fn(),
  englishAliasFor: vi.fn(),
}));
vi.mock('@/lib/genres/lastfm', () => ({
  topTagsByMbid: vi.fn(),
  topTagsByName: vi.fn(),
}));
vi.mock('@/lib/genres/genresDal', () => ({ writeGenres: vi.fn() }));

import { POST } from './route';

const DJ_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DJ_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

function req() {
  return new Request('http://localhost/api/live/x/enrich-artist', { method: 'POST' });
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}
function event(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: EVENT_ID, dj_id: DJ_ID, status: 'live', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: DJ_ID });
});

describe('POST /api/live/[id]/enrich-artist', () => {
  it('404s for a non-uuid id before any query', async () => {
    const res = await POST(req(), params('banana'));
    expect(res.status).toBe(404);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('404s for a partner, not 403', async () => {
    maybeSingle.mockResolvedValue({ data: event({ dj_id: DJ_ID }) });
    requireUser.mockResolvedValue({ id: 'partner-1' });

    const res = await POST(req(), params(EVENT_ID));

    expect(res.status).toBe(404);
  });

  it('404s for a DJ who owns a different event', async () => {
    maybeSingle.mockResolvedValue({ data: event({ dj_id: DJ_ID }) });
    requireUser.mockResolvedValue({ id: OTHER_DJ_ID });

    const res = await POST(req(), params(EVENT_ID));

    expect(res.status).toBe(404);
  });

  it('404s for a non-live event', async () => {
    maybeSingle.mockResolvedValue({ data: event({ status: 'upcoming' }) });

    const res = await POST(req(), params(EVENT_ID));

    expect(res.status).toBe(404);
  });

  it('404s for no such event', async () => {
    maybeSingle.mockResolvedValue({ data: null });

    const res = await POST(req(), params(EVENT_ID));

    expect(res.status).toBe(404);
  });

  it('calls dj_claim_next_artist with the event id, and returns claimed:false when nothing is due', async () => {
    maybeSingle.mockResolvedValue({ data: event() });
    rpc.mockResolvedValue({ data: [], error: null });

    const res = await POST(req(), params(EVENT_ID));
    const body = await res.json();

    expect(rpc).toHaveBeenCalledWith('dj_claim_next_artist', { p_event_id: EVENT_ID });
    expect(body).toEqual({ claimed: false });
    expect(enrichArtist).not.toHaveBeenCalled();
  });

  it('returns 503 and claimed:false when the claim RPC itself errors', async () => {
    maybeSingle.mockResolvedValue({ data: event() });
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } });

    const res = await POST(req(), params(EVENT_ID));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ claimed: false });
  });

  it('calls enrichArtist with the claimed artist and returns its outcome status', async () => {
    maybeSingle.mockResolvedValue({ data: event() });
    rpc.mockResolvedValue({
      data: [{ spotify_artist_id: 'artist-1', artist_name: 'Some Artist' }],
      error: null,
    });
    enrichArtist.mockResolvedValue({ status: 'resolved', genres: {}, resolvedVia: 'none' });

    const res = await POST(req(), params(EVENT_ID));
    const body = await res.json();

    expect(enrichArtist).toHaveBeenCalledWith(
      { eventId: EVENT_ID, artistId: 'artist-1', name: 'Some Artist' },
      expect.objectContaining({
        mbidForSpotifyArtist: expect.any(Function),
        englishAliasFor: expect.any(Function),
        topTagsByMbid: expect.any(Function),
        topTagsByName: expect.any(Function),
        writeGenres: expect.any(Function),
      }),
    );
    expect(body).toEqual({ claimed: true, status: 'resolved' });
  });

  it('returns claimed:true, status:failed (200, not 500) when enrichArtist throws', async () => {
    maybeSingle.mockResolvedValue({ data: event() });
    rpc.mockResolvedValue({
      data: [{ spotify_artist_id: 'artist-1', artist_name: 'Some Artist' }],
      error: null,
    });
    enrichArtist.mockRejectedValue(new Error('boom'));

    const res = await POST(req(), params(EVENT_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ claimed: true, status: 'failed' });
  });
});
