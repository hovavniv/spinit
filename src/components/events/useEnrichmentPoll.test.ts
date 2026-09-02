import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useEnrichmentPoll } from './useEnrichmentPoll';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('useEnrichmentPoll', () => {
  it('stops polling when remaining reaches 0', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ remaining: 0, settled: 30, total: 30 }));
    vi.stubGlobal('fetch', f);
    renderHook(() => useEnrichmentPoll('p-1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('keeps polling while remaining is above 0', async () => {
    let left = 3;
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ remaining: --left, settled: 3 - left, total: 3 }));
    vi.stubGlobal('fetch', f);
    renderHook(() => useEnrichmentPoll('p-1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('stops polling on an error rather than hammering the route', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response('nope', { status: 503 }));
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useEnrichmentPoll('p-1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(f).toHaveBeenCalledTimes(1);
    expect(result.current.stopped).toBe(true);
  });

  it('renders a count, not an indefinite spinner', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ remaining: 18, settled: 12, total: 30 })));
    const { result } = renderHook(() => useEnrichmentPoll('p-1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current.progress).toEqual({ settled: 12, total: 30 });
  });

  it('does not poll at all when partnerId is null', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ remaining: 0 }));
    vi.stubGlobal('fetch', f);
    renderHook(() => useEnrichmentPoll(null));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(f).not.toHaveBeenCalled();
  });

  it('issues no further request after unmount', async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ remaining: 5, settled: 1, total: 6 }));
    vi.stubGlobal('fetch', f);
    const { unmount } = renderHook(() => useEnrichmentPoll('p-1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    const before = f.mock.calls.length;
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(f).toHaveBeenCalledTimes(before);
  });

  it('backs off rather than re-polling immediately when nothing was claimed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ remaining: 5, settled: 1, total: 6, retryAfter: 60 })));
    renderHook(() => useEnrichmentPoll('p-1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
