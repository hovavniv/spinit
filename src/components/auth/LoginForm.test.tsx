import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm';
import type { ActionResult } from '@/lib/auth/errors';

// LoginForm takes its server action as a `vi.fn()` prop, never
// `vi.mock('@/lib/auth/actions')` (design 6, design 10.3) — the action here
// stands in for `signInWithPassword`.

describe('LoginForm', () => {
  it('never calls the action when the client-side validation fails', async () => {
    const user = userEvent.setup();
    const action = vi.fn<(prevState: ActionResult, formData: FormData) => Promise<ActionResult>>();

    render(<LoginForm onSwitchToRegister={() => {}} action={action} />);

    // Email left empty — loginSchema.safeParse must fail before the action
    // is ever invoked.
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it('renders the message from a failed action result', async () => {
    const user = userEvent.setup();
    const action = vi.fn<(prevState: ActionResult, formData: FormData) => Promise<ActionResult>>(
      async () => ({ ok: false, message: 'Email or password is incorrect.' }),
    );

    render(<LoginForm onSwitchToRegister={() => {}} action={action} />);

    await user.type(screen.getByLabelText('Email'), 'dj@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
  });
});
