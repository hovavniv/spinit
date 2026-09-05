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
    <GuestPicker token={TOKEN} usedCount={usedCount} suggestAction={suggestAction as never} />,
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

  // M1: a failed suggestAction call must not leave the button reading
  // "Requested ✓" -- the toast already says it failed, and a guest cannot
  // retry a button that is both mislabeled AND still disabled.
  it('rolls back to "Request" (not "Requested ✓") when suggestAction fails', async () => {
    const suggestAction = vi.fn(
      async (): Promise<SuggestActionResult> => ({ ok: false, code: 'unknown', message: 'Something went wrong.' }),
    );
    await search(suggestAction);

    await user.click(screen.getByRole('button', { name: /request dancing queen/i }));

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^request dancing queen by abba$/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /requested dancing queen/i })).not.toBeInTheDocument();
  });

  it('renders "already up — backed it for you" when guest_suggest returns was_existing', async () => {
    const suggestAction = vi.fn(
      async (): Promise<SuggestActionResult> => ({ ok: true, suggestionId: 's1', wasExisting: true }),
    );
    await search(suggestAction);

    await user.click(screen.getByRole('button', { name: /request dancing queen/i }));

    expect(await screen.findByText(/already up.*backed it for you/i)).toBeInTheDocument();
  });

  // F3: no sessionId prop exists on this component any more -- it is a
  // 'use client' component, so anything passed as a prop is serialized into
  // the RSC payload and readable by any script on the page. suggestAction
  // is called with the TOKEN, which reads the real session id off the
  // httpOnly cookie server-side instead.
  it('calls suggestAction with the token, and never receives a sessionId prop', async () => {
    const suggestAction = vi.fn(
      async (): Promise<SuggestActionResult> => ({ ok: true, suggestionId: 's1', wasExisting: false }),
    );
    await search(suggestAction);

    await user.click(screen.getByRole('button', { name: /request dancing queen/i }));

    expect(suggestAction).toHaveBeenCalledWith(TOKEN, TRACK.id, TRACK.name, TRACK.artistNames[0]);
  });

  it('shows "nothing matched" and no free-text fallback when the search returns no rows', async () => {
    render(<GuestPicker token={TOKEN} usedCount={0} suggestAction={vi.fn() as never} />);
    vi.stubGlobal('fetch', mockSearch([]));
    await user.type(screen.getByRole('combobox'), 'zzzz');
    await vi.advanceTimersByTimeAsync(500);

    expect(await screen.findByText(/nothing matched/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request/i })).not.toBeInTheDocument();
  });
});
