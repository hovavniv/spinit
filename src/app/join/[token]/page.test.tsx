import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));
// notFound() is left REAL (not mocked) -- same pattern as
// events/[id]/live/page.test.tsx -- its thrown digest is what
// `rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK/)` asserts against below.
// useRouter is mocked because JoinForm (a client component) calls it.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/live/guestActions', () => ({
  joinAction: vi.fn(),
}));

import JoinPage from './page';

const VALID_TOKEN = 'a'.repeat(22);

function pageProps(token: string) {
  return { params: Promise.resolve({ token }) };
}

async function renderPage(token: string) {
  const element = await JoinPage(pageProps(token) as never);
  return render(element as React.ReactElement);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/join/[token]', () => {
  it('404s a malformed token shape before ever calling the database', async () => {
    await expect(JoinPage(pageProps('not-a-valid-token') as never)).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('404s a token one character short of the required 22', async () => {
    await expect(JoinPage(pageProps('a'.repeat(21)) as never)).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK/,
    );
  });

  it('renders a friendly message for a token that does not exist, not a 404 shell', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'no_such_event' } });

    await renderPage(VALID_TOKEN);

    expect(screen.getByText(/isn.t valid/i)).toBeInTheDocument();
  });

  it('shows the join form and a Live now pill for a live event', async () => {
    rpc.mockResolvedValue({ data: [{ couple_names: 'Dana & Yossi', is_live: true }], error: null });

    await renderPage(VALID_TOKEN);

    expect(screen.getByText(/Live now/i)).toBeInTheDocument();
    expect(screen.getByText(/Dana & Yossi/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join the floor/i })).toBeInTheDocument();
  });

  it('shows an ended/not-started message instead of the form when the event is not live', async () => {
    rpc.mockResolvedValue({ data: [{ couple_names: 'Dana & Yossi', is_live: false }], error: null });

    await renderPage(VALID_TOKEN);

    expect(screen.queryByRole('button', { name: /join the floor/i })).not.toBeInTheDocument();
    expect(screen.getByText(/hasn.t started|is over/i)).toBeInTheDocument();
  });
});
