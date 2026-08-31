import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BlocklistSection } from './BlocklistSection';
import type { BlocklistRow } from '@/lib/events/detailTypes';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

function row(overrides: Partial<BlocklistRow> = {}): BlocklistRow {
  return {
    id: 'row-1',
    segment: 'party',
    entry_type: 'artist',
    value: 'Nickelback',
    spotify_id: 'bbbbbbbbbbbbbbbbbbbbbb',
    created_at: '2026-08-30T10:00:00Z',
    ...overrides,
  };
}

function renderSection(rows: BlocklistRow[]) {
  return render(
    <BlocklistSection
      eventId={EVENT_ID}
      segment="party"
      blurb="Keep these off the dance floor."
      rows={rows}
      addAction={vi.fn()}
      removeAction={vi.fn()}
    />,
  );
}

describe('BlocklistSection', () => {
  test('renders the value beside its type pill', () => {
    renderSection([row(), row({ id: 'row-2', entry_type: 'song', value: 'Cha Cha Slide' })]);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Nickelback')).toBeInTheDocument();
    expect(screen.getByText('artist')).toBeInTheDocument();
    expect(screen.getByText('song')).toBeInTheDocument();
  });

  test('offers exactly the three entry types', () => {
    renderSection([]);

    const select = screen.getByLabelText('Type');
    expect(select).toBeInTheDocument();
    expect(screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual([
      'artist',
      'song',
      'genre',
    ]);
  });

  test('renders nothing above the add form when the list is empty', () => {
    renderSection([]);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  test('gives every row its own remove control, named for the value', () => {
    renderSection([row()]);
    expect(screen.getByRole('button', { name: 'Remove Nickelback' })).toBeInTheDocument();
  });

  test('shows a TrackPicker for Artist and Song', async () => {
    const user = userEvent.setup();
    renderSection([]);

    await user.selectOptions(screen.getByRole('combobox', { name: /type/i }), 'artist');
    expect(await screen.findByPlaceholderText(/search/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: /type/i }), 'song');
    expect(await screen.findByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  test('swaps to a GenrePicker for Genre', async () => {
    const user = userEvent.setup();
    renderSection([]);

    await user.selectOptions(screen.getByRole('combobox', { name: /type/i }), 'genre');
    const comboboxes = screen.getAllByRole('combobox');
    const genreInput = comboboxes[comboboxes.length - 1];
    await user.type(genreInput, 'po');
    expect(await screen.findByText(/common genres/i)).toBeInTheDocument();
    expect(screen.queryByText(/searching spotify/i)).not.toBeInTheDocument();
  });
});
