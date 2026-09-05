import { describe, expect, it, vi, beforeEach } from 'vitest';

const { rpc, from, cookieGet, searchTracks } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  cookieGet: vi.fn(),
  searchTracks: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc, from }),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));
vi.mock('@/lib/spotify/search', () => ({
  searchTracks: (q: string) => searchTracks(q),
}));

import { GET } from './route';

const VALID_TOKEN = 'a'.repeat(22);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function request(token: string, q: string) {
  return {
    request: new Request(`http://localhost:3000/join/${token}/search?q=${encodeURIComponent(q)}`),
    context: { params: Promise.resolve({ token }) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /join/[token]/search', () => {
  it('404s a malformed token shape before ever reading a cookie', async () => {
    const { request: req, context } = request('bad-token', 'abba');
    const response = await GET(req, context);

    expect(response.status).toBe(404);
    expect(cookieGet).not.toHaveBeenCalled();
  });

  it('401s when the guest session cookie is absent', async () => {
    cookieGet.mockReturnValue(undefined);
    const { request: req, context } = request(VALID_TOKEN, 'abba');

    const response = await GET(req, context);

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('429s with search_limit when guest_search_allow returns false', async () => {
    cookieGet.mockReturnValue({ value: SESSION_ID });
    rpc.mockResolvedValue({ data: false, error: null });
    const { request: req, context } = request(VALID_TOKEN, 'abba');

    const response = await GET(req, context);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({ error: 'search_limit' });
    expect(searchTracks).not.toHaveBeenCalled();
  });

  it('returns results and writes nothing to the database', async () => {
    cookieGet.mockReturnValue({ value: SESSION_ID });
    rpc.mockResolvedValue({ data: true, error: null });
    searchTracks.mockResolvedValue([{ id: 'x'.repeat(22), name: 'Dancing Queen' }]);
    const { request: req, context } = request(VALID_TOKEN, 'abba');

    const response = await GET(req, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(1);
    // The route calls `.rpc` (for guest_search_allow) but never `.from` --
    // there is no legitimate reason for this route to touch a table.
    expect(from).not.toHaveBeenCalled();
  });

  it('propagates a busy (429) SpotifyError as { error: busy }', async () => {
    cookieGet.mockReturnValue({ value: SESSION_ID });
    rpc.mockResolvedValue({ data: true, error: null });
    const { SpotifyError } = await import('@/lib/spotify/client');
    searchTracks.mockRejectedValue(new SpotifyError('rate_limited', 429, '/search'));
    const { request: req, context } = request(VALID_TOKEN, 'abba');

    const response = await GET(req, context);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({ error: 'busy' });
  });
});
