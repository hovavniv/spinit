import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { InviteStep } from './InviteStep';
import type { WizardPartner } from '@/lib/events/newEventTypes';

const sendAction = vi.fn(async (_prev: unknown, _data: FormData) => ({ ok: true as const }));
const EVENT_ID = '11111111-2222-4333-8444-555555555555';

function renderStep(partners: WizardPartner[]) {
  return render(
    <InviteStep
      eventId={EVENT_ID}
      partner1Name="Alex"
      partner2Name="Sam"
      partners={partners}
      sendAction={sendAction}
    />,
  );
}

describe('InviteStep', () => {
  test('labels each email with the name from step 1', () => {
    renderStep([]);

    expect(screen.getByLabelText(/Alex.s email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sam.s email/)).toBeInTheDocument();
  });

  test('pre-fills each address from the existing row for that SLOT, not by array position', () => {
    // The rows arrive deliberately out of order. Both are written by one
    // statement, so created_at is byte-identical and PostgREST can return them
    // either way round -- indexing by position would put Sam's address in
    // Alex's field and the DJ would send the wrong link to the wrong person.
    renderStep([
      { slot: 2, display_name: 'Sam', invite_email: 'sam@example.org' },
      { slot: 1, display_name: 'Alex', invite_email: 'alex@example.org' },
    ]);

    expect(screen.getByLabelText(/Alex.s email/)).toHaveValue('alex@example.org');
    expect(screen.getByLabelText(/Sam.s email/)).toHaveValue('sam@example.org');
  });

  test('says the DJ sends the links, not that an email goes out', () => {
    renderStep([]);

    expect(screen.getByText(/send however you like/i)).toBeInTheDocument();
  });

  test('points Back at the pre-filled step 1', () => {
    renderStep([]);

    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute(
      'href',
      `/events/new/${EVENT_ID}`,
    );
  });
});
