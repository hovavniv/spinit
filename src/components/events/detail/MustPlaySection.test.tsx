import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MustPlaySection } from './MustPlaySection';
import type { MustPlayRow } from '@/lib/events/detailTypes';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

function row(overrides: Partial<MustPlayRow> = {}): MustPlayRow {
  return {
    id: 'row-1',
    segment: 'party',
    title: 'September',
    artist: 'Earth, Wind & Fire',
    moment: null,
    spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa',
    spotify_artist_id: 'bbbbbbbbbbbbbbbbbbbbbb',
    created_at: '2026-08-30T10:00:00Z',
    ...overrides,
  };
}

function renderSection(rows: MustPlayRow[]) {
  return render(
    <MustPlaySection
      eventId={EVENT_ID}
      segment="party"
      blurb="Peak dance floor."
      rows={rows}
      addAction={vi.fn()}
      removeAction={vi.fn()}
    />,
  );
}

describe('MustPlaySection', () => {
  test('renders one entry per row, with the artist', () => {
    renderSection([row(), row({ id: 'row-2', title: 'Hey Ya!', artist: 'OutKast' })]);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('September')).toBeInTheDocument();
    expect(screen.getByText(/Earth, Wind & Fire/)).toBeInTheDocument();
  });

  test('shows the moment line only when the row has one', () => {
    renderSection([row({ moment: 'First dance' })]);
    expect(screen.getByText('First dance')).toBeInTheDocument();
  });

  test('renders no entries and no list for an empty list', () => {
    // The artboard draws nothing above the add form when the list is empty
    // (hint-placeholder-count="0"); the heading and blurb already say what the
    // list is for (design §7.3).
    renderSection([]);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  test('gives every row its own remove control, named for the song', () => {
    renderSection([row()]);
    expect(screen.getByRole('button', { name: 'Remove September' })).toBeInTheDocument();
  });

  test('carries the event id and the segment into the add form', () => {
    const { container } = renderSection([]);

    expect(container.querySelector('input[name="eventId"]')).toHaveValue(EVENT_ID);
    expect(container.querySelector('input[name="segment"]')).toHaveValue('party');
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  test('renders a picker, not free-text title and artist inputs', () => {
    renderSection([]);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/song title/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/moment/i)).toBeInTheDocument();
  });
});
