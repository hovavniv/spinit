import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthScreen } from './AuthScreen';
import type { ActionResult } from '@/lib/auth/errors';

// AuthScreen calls router.replace() on a mode switch to keep the address bar in
// sync. It does not need a real router to do that — this stubs next/navigation's
// useRouter so the component can call replace() without a Next.js app context.
// Exposed via vi.hoisted so a test can assert what replace() was actually
// called with, not just that it was called.
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

// AuthScreen now takes its server actions as props (design 6, plan task 9) —
// never `vi.mock('@/lib/auth/actions')`. These stand in for
// signInWithPassword / signUpWithPassword and are never expected to resolve
// in the tests below, which only exercise client-side validation.
function noopAction(): Promise<ActionResult> {
  return new Promise(() => {});
}

describe('AuthScreen', () => {
  it('shows the login fields and not the register-only fields when defaultMode is login', () => {
    render(<AuthScreen defaultMode="login" loginAction={noopAction} registerAction={noopAction} />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });

  it('reveals the register-only fields when the Register tab is clicked', async () => {
    const user = userEvent.setup();
    render(<AuthScreen defaultMode="login" loginAction={noopAction} registerAction={noopAction} />);

    await user.click(screen.getByRole('tab', { name: 'Register' }));

    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('DJ business name')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });

  it('switches to register mode via the inline "Create an account" control at the foot of the login form', async () => {
    const user = userEvent.setup();
    render(<AuthScreen defaultMode="login" loginAction={noopAction} registerAction={noopAction} />);

    await user.click(screen.getByRole('button', { name: 'Create an account' }));

    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('DJ business name')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });

  it('switches back to login mode via the inline "Log in" control at the foot of the register form', async () => {
    const user = userEvent.setup();
    render(<AuthScreen defaultMode="register" loginAction={noopAction} registerAction={noopAction} />);

    // "Log in" also names the pill tab (role="tab"), so this must be scoped to
    // plain buttons to reach the inline foot-link uniquely.
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });

  it('shows the password mismatch error on submit and keeps the entered values', async () => {
    const user = userEvent.setup();
    render(<AuthScreen defaultMode="register" loginAction={noopAction} registerAction={noopAction} />);

    await user.type(screen.getByLabelText('Your name'), 'Jordan Ellis');
    await user.type(screen.getByLabelText('DJ business name'), 'Ellis Sound Co.');
    await user.type(screen.getByLabelText('Email'), 'jordan@djcrew.com');
    await user.type(screen.getByLabelText('Confirm email'), 'jordan@djcrew.com');
    await user.type(screen.getByLabelText('Phone number'), '5551234567');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password456');

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveValue('Jordan Ellis');
    expect(screen.getByLabelText('Email')).toHaveValue('jordan@djcrew.com');
    expect(screen.getByLabelText('Password')).toHaveValue('password123');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('password456');
  });

  it('preserves ?invite=&slot= when switching from login to register mode', async () => {
    const user = userEvent.setup();
    replace.mockClear();
    render(
      <AuthScreen
        defaultMode="login"
        loginAction={noopAction}
        registerAction={noopAction}
        invitePath="/invite/11111111-1111-4111-8111-111111111111/2"
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Register' }));

    expect(replace).toHaveBeenCalledWith(
      '/register?invite=11111111-1111-4111-8111-111111111111&slot=2',
    );
  });

  it('preserves ?invite=&slot= when switching from register to login mode', async () => {
    const user = userEvent.setup();
    replace.mockClear();
    render(
      <AuthScreen
        defaultMode="register"
        loginAction={noopAction}
        registerAction={noopAction}
        invitePath="/invite/11111111-1111-4111-8111-111111111111/2"
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Log in' }));

    expect(replace).toHaveBeenCalledWith(
      '/login?invite=11111111-1111-4111-8111-111111111111&slot=2',
    );
  });

  it('shows the required-email error when the login form is submitted with an empty email', async () => {
    const user = userEvent.setup();
    render(<AuthScreen defaultMode="login" loginAction={noopAction} registerAction={noopAction} />);

    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
  });
});
