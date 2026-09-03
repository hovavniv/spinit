import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EventDetailsStep } from './EventDetailsStep';
import type { WizardEvent } from '@/lib/events/newEventTypes';

const saveAction = vi.fn(async (_prev: unknown, _data: FormData) => ({ ok: true as const }));

const event: WizardEvent = {
  id: '11111111-2222-4333-8444-555555555555',
  couple_names: 'Alex & Sam',
  partner1_name: 'Alex',
  partner2_name: 'Sam',
  event_date: '2026-10-04',
  venue: 'Brookline Barn',
  guest_count: 120,
  status: 'draft',
  partners: [],
};

describe('EventDetailsStep', () => {
  test('renders the artboard\'s five fields', () => {
    render(<EventDetailsStep event={null} saveAction={saveAction} />);

    expect(screen.getByLabelText('Partner 1 name')).toBeInTheDocument();
    expect(screen.getByLabelText('Partner 2 name')).toBeInTheDocument();
    expect(screen.getByLabelText('Wedding date')).toBeInTheDocument();
    expect(screen.getByLabelText('Venue')).toBeInTheDocument();
    expect(screen.getByLabelText('Estimated guest count')).toBeInTheDocument();
  });

  test('submits no event id when creating', () => {
    render(<EventDetailsStep event={null} saveAction={saveAction} />);

    expect(screen.getByTestId('event-id')).toHaveValue('');
  });

  test('pre-fills every field from an existing draft', () => {
    render(<EventDetailsStep event={event} saveAction={saveAction} />);

    expect(screen.getByLabelText('Partner 1 name')).toHaveValue('Alex');
    expect(screen.getByLabelText('Partner 2 name')).toHaveValue('Sam');
    expect(screen.getByLabelText('Wedding date')).toHaveValue('2026-10-04');
    expect(screen.getByLabelText('Venue')).toHaveValue('Brookline Barn');
    expect(screen.getByLabelText('Estimated guest count')).toHaveValue(120);
    expect(screen.getByTestId('event-id')).toHaveValue(event.id);
  });

  test('leaves a null guest count blank rather than rendering 0', () => {
    render(<EventDetailsStep event={{ ...event, guest_count: null }} saveAction={saveAction} />);

    expect(screen.getByLabelText('Estimated guest count')).toHaveValue(null);
  });
});
