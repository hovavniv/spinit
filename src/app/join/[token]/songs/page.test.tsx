import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { rpc, cookieGet, cookieDelete, redirectMock } = vi.hoisted(() => ({
  rpc: vi.fn(),
  cookieGet: vi.fn(),
  cookieDelete: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;push;${url};307;` });
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: cookieGet, delete: cookieDelete })),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/live/guestActions', () => ({
  suggestAction: vi.fn(),
  voteAction: vi.fn(),
}));

import SongsPage from './page';

const VALID_TOKEN = 'a'.repeat(22);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function pageProps(token: string) {
  return { params: Promise.resolve({ token }) };
}

async function renderPage(token: string) {
  const element = await SongsPage(pageProps(token) as never);
  return render(element as React.ReactElement);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/join/[token]/songs', () => {
  it('404s a malformed token before ever reading a cookie', async () => {
    const notFoundError = await SongsPage(pageProps('bad-token') as never).catch((e) => e);
    expect(String(notFoundError.digest ?? notFoundError.message)).toMatch(
      /NEXT_HTTP_ERROR_FALLBACK|NOT_FOUND/,
    );
    expect(cookieGet).not.toHaveBeenCalled();
  });

  it('redirects to /join/[token] (not 404) when a shape-valid token has no session cookie', async () => {
    cookieGet.mockReturnValue(undefined);

    await expect(SongsPage(pageProps(VALID_TOKEN) as never)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(`/join/${VALID_TOKEN}`);
  });

  it('clears the cookie and redirects on no_such_session', async () => {
    cookieGet.mockReturnValue({ value: SESSION_ID });
    rpc.mockResolvedValue({ data: null, error: { message: 'no_such_session' } });

    await expect(SongsPage(pageProps(VALID_TOKEN) as never)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(cookieDelete).toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith(`/join/${VALID_TOKEN}`);
  });

  it('renders the picker and queue for a valid session', async () => {
    cookieGet.mockReturnValue({ value: SESSION_ID });
    rpc.mockResolvedValue({
      data: [
        {
          suggestion_id: 's1',
          title: 'September',
          artist: 'Earth, Wind & Fire',
          votes: 3,
          voted: false,
          mine: true,
          used_count: 1,
        },
      ],
      error: null,
    });

    await renderPage(VALID_TOKEN);

    expect(screen.getByText('September by Earth, Wind & Fire')).toBeInTheDocument();
    expect(screen.getByText(/1 of your 3 song suggestions used/)).toBeInTheDocument();
  });

  it('renders the not-live message on event_not_live', async () => {
    cookieGet.mockReturnValue({ value: SESSION_ID });
    rpc.mockResolvedValue({ data: null, error: { message: 'event_not_live' } });

    await renderPage(VALID_TOKEN);

    expect(screen.getByText(/hasn.t started|is over/i)).toBeInTheDocument();
  });
});
