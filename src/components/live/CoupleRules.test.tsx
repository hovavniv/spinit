import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CoupleRules } from './CoupleRules';
import type { BlocklistRow } from '@/lib/events/detailTypes';

function partyBlockRow(overrides: Partial<BlocklistRow> = {}): BlocklistRow {
  return {
    id: 'bl-1',
    segment: 'party',
    entry_type: 'artist',
    value: 'Nickelback',
    spotify_id: 'artist-nickelback',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('CoupleRules', () => {
  it('does not render a party-segment blocklist row during the reception phase', () => {
    render(
      <CoupleRules
        mustPlay={[]}
        blocklist={[partyBlockRow()]}
        played={[]}
        mustPlayProgress={{ played: 0, total: 0 }}
        phase="dinner"
      />,
    );

    expect(screen.queryByText('Nickelback')).not.toBeInTheDocument();
  });

  it('renders the same party-segment blocklist row once the phase is open-floor', () => {
    render(
      <CoupleRules
        mustPlay={[]}
        blocklist={[partyBlockRow()]}
        played={[]}
        mustPlayProgress={{ played: 0, total: 0 }}
        phase="open-floor"
      />,
    );

    expect(screen.getByText('Nickelback')).toBeInTheDocument();
  });
});
