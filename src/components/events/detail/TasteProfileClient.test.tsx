import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TasteProfileClient } from './TasteProfileClient';
import type { PartnerRow } from '@/lib/events/detailTypes';

afterEach(() => {
  vi.unstubAllGlobals();
});

const profile = () => ({
  partnerId: 'x',
  computedAt: '2026-08-31T00:00:00Z',
  topArtists: [],
});

function connectedPartner(over: Partial<PartnerRow>): PartnerRow {
  return {
    id: 'p-default',
    slot: 1,
    display_name: 'Someone',
    user_id: 'u-1',
    connection: { status: 'connected' },
    profile: profile(),
    ...over,
  };
}

describe('TasteProfileClient', () => {
  it('sums each partner poll into ONE combined progress -- partner1 2/5, partner2 1/3 -> 3/8', async () => {
    // Deliberate design resolution (plan task 10's gap): each partner polls
    // their OWN queue independently, and this is the one place the two get
    // combined. Distinct partner ids route the mocked fetch to distinct
    // responses so this pins the SUM, not just "a number came through".
    const f = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { partnerId: string };
      if (body.partnerId === 'partner-1') {
        return Response.json({ remaining: 3, settled: 2, total: 5 });
      }
      return Response.json({ remaining: 2, settled: 1, total: 3 });
    });
    vi.stubGlobal('fetch', f);

    render(
      <TasteProfileClient
        partner1={connectedPartner({ id: 'partner-1', display_name: 'Maya' })}
        partner2={connectedPartner({ id: 'partner-2', display_name: 'Chris' })}
        genresByArtistId={{}}
        enrichmentProgress={{ settled: 0, total: 0 }}
      />,
    );

    expect(await screen.findByText(/2 of 5|3 of 8/)).toBeInTheDocument();
    // The combined count, not either partner's own count.
    expect(screen.getByText('3 of 8')).toBeInTheDocument();
  });

  it('treats a not-yet-connected partner as contributing 0/0, and never polls them', async () => {
    const f = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ remaining: 2, settled: 1, total: 3 }));
    vi.stubGlobal('fetch', f);

    render(
      <TasteProfileClient
        partner1={connectedPartner({ id: 'partner-1', display_name: 'Maya' })}
        partner2={connectedPartner({
          id: 'partner-2', display_name: 'Chris', connection: null,
        })}
        genresByArtistId={{}}
        enrichmentProgress={{ settled: 0, total: 0 }}
      />,
    );

    // Only partner1 is connected/has a profile, so only one fetch call ever
    // happens, and the combined total is partner1's alone (1 of 3).
    expect(await screen.findByText('1 of 3')).toBeInTheDocument();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
