import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLivePoll, type LivePollState } from './useLivePoll';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

function state(overrides: Partial<LivePollState> = {}): LivePollState {
  return {
    queue: [],
    blocked: [],
    activity: [],
    mustPlayProgress: { played: 0, total: 0 },
    unresolvedArtistIds: [],
    now: '2026-09-05T20:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useLivePoll', () => {
  it('polls the state route every 8 seconds', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(state()));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useLivePoll(EVENT_ID, state()));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(`/api/live/${EVENT_ID}/state`);

    await vi.advanceTimersByTimeAsync(8_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await vi.advanceTimersByTimeAsync(8_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('keeps the last good state and does not blank the queue when a poll fails', async () => {
    const goodState = state({ queue: [{ suggestion: { id: 's1' } } as never] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(goodState))
      .mockResolvedValueOnce(jsonResponse(null, false));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useLivePoll(EVENT_ID, state()));

    await waitFor(() => expect(result.current.state.queue).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(8_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The failed poll must not have cleared the queue.
    expect(result.current.state.queue).toHaveLength(1);
    expect(result.current.reconnecting).toBe(true);
  });

  it('retries after a failure rather than stopping permanently', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(jsonResponse(state()));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useLivePoll(EVENT_ID, state()));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Backoff after one failure: 8s * 2^1 = 16s.
    await vi.advanceTimersByTimeAsync(16_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // Backoff after two failures: 8s * 2^2 = 32s.
    await vi.advanceTimersByTimeAsync(32_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    await waitFor(() => expect(result.current.reconnecting).toBe(false));
  });

  it('pauses while the tab is hidden and resumes on visibilitychange', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(state()));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useLivePoll(EVENT_ID, state()));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(8_000);
    // The scheduled poll runs, sees the tab hidden, and does not fetch again.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Time passing further while hidden still must not fetch.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
