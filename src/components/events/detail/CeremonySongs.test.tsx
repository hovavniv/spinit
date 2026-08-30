import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CeremonySongs } from './CeremonySongs';
import type { MustPlayRow } from '@/lib/events/detailTypes';

function ceremonyRow(moment: string, title: string, id: string): MustPlayRow {
  return { id, segment: 'ceremony', title, artist: 'Traditional', moment, created_at: '2026-08-30T10:00:00Z' };
}

describe('CeremonySongs', () => {
  test('draws both slots in CEREMONY_SLOTS order', () => {
    render(<CeremonySongs rows={[]} />);

    expect(screen.getByText('Walking down the aisle')).toBeInTheDocument();
    expect(screen.getByText('Breaking the glass')).toBeInTheDocument();
  });

  test('fills a slot from the row whose moment matches it', () => {
    render(<CeremonySongs rows={[ceremonyRow('Breaking the glass', 'Hava Nagila', 'row-9')]} />);

    expect(screen.getByLabelText('Breaking the glass song title')).toHaveValue('Hava Nagila');
    expect(screen.getByLabelText('Walking down the aisle song title')).toHaveValue('');
  });

  test('carries the existing row id so the save can write by id', () => {
    // The write is keyed by row id, never by an upsert conflict target
    // (design §6.4) — so the id has to reach the action through the form.
    const { container } = render(
      <CeremonySongs rows={[ceremonyRow('Breaking the glass', 'Hava Nagila', 'row-9')]} />,
    );

    expect(container.querySelector('input[name="ceremony-1-id"]')).toHaveValue('row-9');
    expect(container.querySelector('input[name="ceremony-0-id"]')).toHaveValue('');
  });

  test('associates every control with the details form rather than nesting one', () => {
    const { container } = render(<CeremonySongs rows={[]} />);

    expect(container.querySelectorAll('form')).toHaveLength(0);
    for (const input of container.querySelectorAll('input')) {
      expect(input.getAttribute('form')).toBe('event-details');
    }
  });
});
