import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { NewEventShell } from '@/components/events/new/NewEventShell';
import { EventDetailsStep } from '@/components/events/new/EventDetailsStep';

const saveAction = vi.fn(async (_prev: unknown, _data: FormData) => ({ ok: true as const }));

describe('/events/new', () => {
  test('renders step 1 with the first step marked current', () => {
    // ONE LEVEL ABOVE the component, deliberately. A prop can be fully typed
    // and fixture-tested while nothing in the app ever populates it -- this
    // repo has shipped exactly that. A component's own test hands the value in
    // directly and so can never catch it; this one renders the composition the
    // route actually returns.
    render(
      <NewEventShell current={1} title="New event">
        <EventDetailsStep event={null} saveAction={saveAction} />
      </NewEventShell>,
    );

    expect(screen.getByText('1')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('3')).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { name: 'New event' })).toBeInTheDocument();
    expect(screen.getByLabelText('Partner 1 name')).toBeInTheDocument();
  });
});
