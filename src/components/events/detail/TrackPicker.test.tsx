import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TrackPicker } from './TrackPicker';

const TEN = Array.from({ length: 10 }, (_, i) => ({
  id: `${i}`.padStart(22, 'a'),
  name: `Song ${i}`,
  artistNames: [`Artist ${i}`],
  artistIds: [`${i}`.padStart(22, 'b')],
  albumName: `Album ${i}`,
  artworkUrl: null,
  durationMs: 1000 + i,
  explicit: false,
}));

const ABBA_RESULT = {
  id: 'c'.repeat(22),
  name: 'Dancing Queen',
  artistNames: ['ABBA'],
  artistIds: ['d'.repeat(22)],
  albumName: 'Arrival',
  artworkUrl: null,
  durationMs: 230000,
  explicit: false,
};

const ABBA_ARTIST_RESULT = {
  id: 'e'.repeat(22),
  name: 'ABBA',
  artworkUrl: null,
};

function mockSearch(results: unknown[], status = 200) {
  return vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ results }), { status }));
}

const props = { fields: { kind: 'titleArtist' as const, titleName: 'title', artistName: 'artist' } };

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  // `shouldAdvanceTime: true` is required here beyond the plan's bare
  // `vi.useFakeTimers()` — without it, every `userEvent` interaction (even a
  // single keystroke on a plain <input>, verified in isolation outside this
  // component) hangs indefinitely in this repo's installed combination of
  // vitest 4.1.11 + @testing-library/user-event 14.6.6. This option lets
  // sinon's fake clock tick forward on real wall-clock progress for timers
  // userEvent schedules internally, while `vi.advanceTimersByTimeAsync` below
  // still deterministically drives the picker's own 300ms debounce timer.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
});

describe('TrackPicker', () => {
  it('does not search under two characters', async () => {
    const f = mockSearch([]);
    vi.stubGlobal('fetch', f);
    render(<TrackPicker {...props} />);
    await user.type(screen.getByRole('combobox'), 'a');
    await vi.advanceTimersByTimeAsync(500);
    expect(f).not.toHaveBeenCalled();
  });

  it('debounces: rapid typing produces ONE request', async () => {
    const f = mockSearch(TEN);
    vi.stubGlobal('fetch', f);
    render(<TrackPicker {...props} />);
    await user.type(screen.getByRole('combobox'), 'abc');
    await vi.advanceTimersByTimeAsync(500);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('aborts the in-flight request on a new keystroke', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: RequestInfo | URL, init: RequestInit) => {
        signals.push(init.signal!);
        return new Response(JSON.stringify({ results: TEN }), { status: 200 });
      }),
    );
    render(<TrackPicker {...props} />);
    await user.type(screen.getByRole('combobox'), 'ab');
    await vi.advanceTimersByTimeAsync(400);
    await user.type(screen.getByRole('combobox'), 'c');
    await vi.advanceTimersByTimeAsync(400);
    expect(signals[0].aborted).toBe(true);
  });

  it('renders at most six rows even when ten come back', async () => {
    vi.stubGlobal('fetch', mockSearch(TEN));
    render(<TrackPicker {...props} />);
    await user.type(screen.getByRole('combobox'), 'song');
    await vi.advanceTimersByTimeAsync(500);
    expect(await screen.findAllByRole('option')).toHaveLength(6);
  });

  it('submits the CANONICAL name, not what was typed', async () => {
    vi.stubGlobal('fetch', mockSearch([{ ...TEN[0], name: 'Nickelback' }]));
    const { container } = render(<TrackPicker {...props} />);
    await user.type(screen.getByRole('combobox'), 'nickelbak');
    await vi.advanceTimersByTimeAsync(500);
    await user.click(await screen.findByText('Nickelback'));
    expect(container.querySelector('input[name="title"]')).toHaveValue('Nickelback');
  });

  it('shows the artist-name hint when fewer than three results return', async () => {
    vi.stubGlobal('fetch', mockSearch(TEN.slice(0, 2)));
    render(<TrackPicker {...props} />);
    await user.type(screen.getByRole('combobox'), 'obscure');
    await vi.advanceTimersByTimeAsync(500);
    expect(await screen.findByText(/try adding the artist name/i)).toBeInTheDocument();
  });

  it('shows a busy message on 429 rather than crashing', async () => {
    vi.stubGlobal('fetch', mockSearch([], 429));
    render(<TrackPicker {...props} />);
    await user.type(screen.getByRole('combobox'), 'abba');
    await vi.advanceTimersByTimeAsync(500);
    expect(await screen.findByText(/busy/i)).toBeInTheDocument();
  });

  it('renders the Searching Spotify header', async () => {
    vi.stubGlobal('fetch', mockSearch(TEN));
    render(<TrackPicker {...props} />);
    await user.type(screen.getByRole('combobox'), 'abba');
    await vi.advanceTimersByTimeAsync(500);
    expect(await screen.findByText(/searching spotify/i)).toBeInTheDocument();
  });

  async function pickFirst(ui: React.ReactElement) {
    const r = render(ui);
    vi.stubGlobal('fetch', mockSearch([ABBA_RESULT]));
    await user.type(screen.getByRole('combobox'), 'abba');
    await vi.advanceTimersByTimeAsync(500);
    await user.click(await screen.findByText('Dancing Queen'));
    return r.container;
  }

  it('writes title and artist separately for must-play', async () => {
    const c = await pickFirst(
      <TrackPicker fields={{ kind: 'titleArtist', titleName: 'title', artistName: 'artist' }} />,
    );
    expect(c.querySelector('input[name="title"]')).toHaveValue('Dancing Queen');
    expect(c.querySelector('input[name="artist"]')).toHaveValue('ABBA');
  });

  it('writes "<name> — <artist>" as a single value for a blocklist song', async () => {
    const c = await pickFirst(<TrackPicker fields={{ kind: 'singleValue', valueName: 'value' }} />);
    expect(c.querySelector('input[name="value"]')).toHaveValue('Dancing Queen — ABBA');
  });

  it('writes only the name for a blocklist artist', async () => {
    const r = render(
      <TrackPicker searchType="artist" fields={{ kind: 'singleValue', valueName: 'value' }} />,
    );
    vi.stubGlobal('fetch', mockSearch([ABBA_ARTIST_RESULT]));
    await user.type(screen.getByRole('combobox'), 'abba');
    await vi.advanceTimersByTimeAsync(500);
    await user.click(await screen.findByText('ABBA'));
    expect(r.container.querySelector('input[name="value"]')).toHaveValue('ABBA');
  });

  it('honours namePrefix, so two ceremony slots do not collide', async () => {
    const c = await pickFirst(
      <TrackPicker
        namePrefix="ceremony-1-"
        fields={{ kind: 'titleArtist', titleName: 'title', artistName: 'artist' }}
      />,
    );
    expect(c.querySelector('input[name="ceremony-1-title"]')).toHaveValue('Dancing Queen');
    expect(c.querySelector('input[name="title"]')).toBeNull();
  });
});
