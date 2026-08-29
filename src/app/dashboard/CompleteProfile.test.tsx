import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CompleteProfile } from './CompleteProfile';
import type { ActionResult } from '@/lib/auth/errors';

// CompleteProfile takes `updateProfile` as a `vi.fn()` prop, never
// `vi.mock('@/lib/auth/actions')` (design 6, design 10.3) — lib/auth/actions
// pulls in `next/headers` and `import 'server-only'`, neither importable
// from jsdom, so the action must always arrive as a prop.

describe('CompleteProfile', () => {
  it('renders the business name and phone fields', () => {
    const updateProfile = vi.fn<(prevState: ActionResult, formData: FormData) => Promise<ActionResult>>();

    render(<CompleteProfile updateProfile={updateProfile} />);

    expect(screen.getByLabelText(/business name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
  });

  it('never calls the action when client-side validation fails', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn<(prevState: ActionResult, formData: FormData) => Promise<ActionResult>>();

    render(<CompleteProfile updateProfile={updateProfile} />);

    // Leave both fields empty — profileSchema.safeParse must fail before the
    // action is ever invoked.
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('DJ business name is required.')).toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('submits via the passed-in action and surfaces returned field errors', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn<(prevState: ActionResult, formData: FormData) => Promise<ActionResult>>(
      async () => ({ ok: false, formErrors: { phone: 'Enter a valid phone number.' } }),
    );

    render(<CompleteProfile updateProfile={updateProfile} />);

    await user.type(screen.getByLabelText(/business name/i), 'Test Business');
    await user.type(screen.getByLabelText(/phone/i), '+15551234567');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(updateProfile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Enter a valid phone number.')).toBeInTheDocument();
  });
});
