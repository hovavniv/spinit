import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CeremonySongs } from './CeremonySongs';
import type { MustPlayRow } from '@/lib/events/detailTypes';

function ceremonyRow(moment: string, title: string, id: string): MustPlayRow {
  return {
    id,
    segment: 'ceremony',
    title,
    artist: 'Traditional',
    moment,
    spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa',
    spotify_artist_id: null,
    created_at: '2026-08-30T10:00:00Z',
  };
}

describe('CeremonySongs', () => {
  test('draws both slots in CEREMONY_SLOTS order', () => {
    render(<CeremonySongs rows={[]} artworkById={{}} />);

    expect(screen.getByText('Walking down the aisle')).toBeInTheDocument();
    expect(screen.getByText('Breaking the glass')).toBeInTheDocument();
  });

  test('fills a slot from the row whose moment matches it', () => {
    render(<CeremonySongs rows={[ceremonyRow('Breaking the glass', 'Hava Nagila', 'row-9')]} artworkById={{}} />);

    expect(screen.getByText(/Hava Nagila/)).toBeInTheDocument();
    // The unfilled slot has no chip, so its picker still shows the search input.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  test('carries the existing row id so the save can write by id', () => {
    // The write is keyed by row id, never by an upsert conflict target
    // (design §6.4) — so the id has to reach the action through the form.
    const { container } = render(
      <CeremonySongs rows={[ceremonyRow('Breaking the glass', 'Hava Nagila', 'row-9')]} artworkById={{}} />,
    );

    expect(container.querySelector('input[name="ceremony-1-id"]')).toHaveValue('row-9');
    expect(container.querySelector('input[name="ceremony-0-id"]')).toHaveValue('');
  });

  test('associates every control with the details form rather than nesting one', () => {
    const { container } = render(<CeremonySongs rows={[]} artworkById={{}} />);

    expect(container.querySelectorAll('form')).toHaveLength(0);
    for (const input of container.querySelectorAll('input')) {
      expect(input.getAttribute('form')).toBe('event-details');
    }
  });

  test('renders one picker per slot and keeps the slot labels', () => {
    render(<CeremonySongs rows={[]} artworkById={{}} />);

    expect(screen.getByText('Walking down the aisle')).toBeInTheDocument();
    expect(screen.getByText('Breaking the glass')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });

  test('the two ceremony pickers write to different field names', () => {
    const { container } = render(<CeremonySongs rows={[]} artworkById={{}} />);

    expect(container.querySelector('input[name="ceremony-0-title"]')).not.toBeNull();
    expect(container.querySelector('input[name="ceremony-1-title"]')).not.toBeNull();
  });

  test('a slot saved before pickers existed shows an empty picker, not a chip with no id', () => {
    // spotify_track_id is null for a row written before the picker existed
    // (B2 added the column nullable; nothing backfills it). Seeding a chip
    // from that would look picked while its hidden id is empty -- clicking
    // Save without touching this slot would then fail validation on a slot
    // that looked fine. The correct behaviour is an empty, re-pickable slot.
    const legacyRow: MustPlayRow = {
      id: 'row-legacy',
      segment: 'ceremony',
      title: 'Some Old Title',
      artist: 'Some Old Artist',
      moment: 'Breaking the glass',
      spotify_track_id: null,
      spotify_artist_id: null,
      created_at: '2026-08-30T10:00:00Z',
    };

    render(<CeremonySongs rows={[legacyRow]} artworkById={{}} />);

    expect(screen.queryByText('Some Old Title')).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });
});
