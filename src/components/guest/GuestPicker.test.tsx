import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GuestPicker } from './GuestPicker';
import type { SuggestActionResult } from '@/lib/live/guestActions';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const TRACK = {
  id: 'c'.repeat(22),
  name: 'Dancing Queen',
  artistNames: ['ABBA'],
  artistIds: ['d'.repeat(22)],
  albumName: 'Arrival',
  artworkUrl: null,
  durationMs: 230000,
  explicit: false,
};

const TOKEN = 'a'.repeat(22);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function mockSearch(results: unknown[], status = 200) {
  return vi.fn(async (_i: RequestInfo | URL) => new Response(JSON.stringify({ results }), { status }));
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  refresh.mockClear();
});

async function search(suggestAction: (...args: never[]) => Promise<SuggestActionResult>, usedCount = 0) {
  const r = render(
    <GuestPicker token={TOKEN} sessionId={SESSION_ID} usedCount={usedCount} suggestAction={suggestAction as never} />,
  );
  vi.stubGlobal('fetch', mockSearch([TRACK]));
  await user.type(screen.getByRole('combobox'), 'abba');
  await vi.advanceTimersByTimeAsync(500);
  await screen.findByText('Dancing Queen');
  return r;
}

describe('GuestPicker', () => {
  it('the cap footer reads from usedCount, not from the number of search results', async () => {
    await search(vi.fn(), 2);
    expect(screen.getByText(/2 of your 3 song suggestions used/)).toBeInTheDocument();
  });

  it('Request becomes Requested ✓ and does not fire a second RPC call on a second click', async () => {
    const suggestAction = vi.fn(
      async (): Promise<SuggestActionResult> => ({ ok: true, suggestionId: 's1', wasExisting: false }),
    );
    await search(suggestAction);

    const button = screen.getByRole('button', { name: /request dancing queen/i });
    await user.click(button);
    await screen.findByRole('button', { name: /requested dancing queen/i });
    await user.click(screen.getByRole('button', { name: /requested dancing queen/i }));

    expect(suggestAction).toHaveBeenCalledTimes(1);
  });

  it('renders "already up — backed it for you" when guest_suggest returns was_existing', async () => {
    const suggestAction = vi.fn(
      async (): Promise<SuggestActionResult> => ({ ok: true, suggestionId: 's1', wasExisting: true }),
    );
    await search(suggestAction);

    await user.click(screen.getByRole('button', { name: /request dancing queen/i }));

    expect(await screen.findByText(/already up.*backed it for you/i)).toBeInTheDocument();
  });

  it('shows "nothing matched" and no free-text fallback when the search returns no rows', async () => {
    render(<GuestPicker token={TOKEN} sessionId={SESSION_ID} usedCount={0} suggestAction={vi.fn() as never} />);
    vi.stubGlobal('fetch', mockSearch([]));
    await user.type(screen.getByRole('combobox'), 'zzzz');
    await vi.advanceTimersByTimeAsync(500);

    expect(await screen.findByText(/nothing matched/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request/i })).not.toBeInTheDocument();
  });
});
