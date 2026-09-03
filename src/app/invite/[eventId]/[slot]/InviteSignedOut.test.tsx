import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { InviteSignedOut } from './InviteSignedOut';

describe('InviteSignedOut', () => {
  it('renders a Create an account link carrying ?invite= and &slot=', () => {
    render(<InviteSignedOut eventId="11111111-1111-4111-8111-111111111111" slot="2" />);

    const registerLink = screen.getByRole('link', { name: 'Create an account' });
    expect(registerLink).toHaveAttribute(
      'href',
      '/register?invite=11111111-1111-4111-8111-111111111111&slot=2',
    );
  });

  it('renders a Log in link carrying ?invite= and &slot=', () => {
    render(<InviteSignedOut eventId="11111111-1111-4111-8111-111111111111" slot="2" />);

    const loginLink = screen.getByRole('link', { name: 'Log in' });
    expect(loginLink).toHaveAttribute(
      'href',
      '/login?invite=11111111-1111-4111-8111-111111111111&slot=2',
    );
  });
});
