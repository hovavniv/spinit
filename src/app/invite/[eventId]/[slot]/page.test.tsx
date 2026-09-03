import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ClaimForm } from './ClaimForm';
import { InviteSignedOut } from './InviteSignedOut';
import type { WizardActionState } from '@/lib/events/newEventTypes';
import type { ActionResult } from '@/lib/auth/errors';

/**
 * InvitePage itself is an async Server Component that awaits
 * `supabase.auth.getUser()` before choosing which of these two to render --
 * awkward to render directly in this repo's jsdom-based test setup (see
 * `src/app/events/new/page.test.tsx` for the same tradeoff). So this file
 * renders each of the two branches directly instead.
 *
 * IMPORTANT: the branch-SELECTION logic itself -- i.e. that a signed-in user
 * gets ClaimForm and a signed-out visitor gets InviteSignedOut -- is NOT
 * covered by this suite. That was verified by a live walk (2026-09-03), not
 * by an automated test.
 */

const claimAction = vi.fn(
  async (_prev: WizardActionState, _data: FormData): Promise<ActionResult> => ({ ok: true }),
);

describe('/invite/[eventId]/[slot] branches', () => {
  it('renders the claim form for the signed-in-user branch', () => {
    render(
      <ClaimForm
        eventId="11111111-1111-4111-8111-111111111111"
        slot="1"
        registerHref="/register?invite=11111111-1111-4111-8111-111111111111&slot=1"
        claimAction={claimAction}
      />,
    );

    expect(screen.getByRole('button', { name: 'Claim your invitation' })).toBeInTheDocument();
  });

  it('renders the signed-out choice for the signed-out-visitor branch', () => {
    render(<InviteSignedOut eventId="11111111-1111-4111-8111-111111111111" slot="1" />);

    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim your invitation' })).not.toBeInTheDocument();
  });
});
