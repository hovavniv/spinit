import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/events/notesActions', () => ({
  saveSharedNotes: vi.fn(),
  savePrivateNotes: vi.fn(),
}));

import { SharedNotesSection } from './SharedNotesSection';
import { NotesSection } from './NotesSection';

describe('SharedNotesSection', () => {
  it('renders the stored body', () => {
    render(<SharedNotesSection eventId="e1" body="both of us agreed" />);

    expect(screen.getByRole('textbox')).toHaveValue('both of us agreed');
  });

  it('says who can read it, because the couple can', () => {
    render(<SharedNotesSection eventId="e1" body="" />);

    expect(screen.getByText(/couple can see/i)).toBeInTheDocument();
  });

  it('carries the event id, so the action does not have to guess it', () => {
    const { container } = render(<SharedNotesSection eventId="e1" body="" />);

    expect(container.querySelector('input[name="eventId"]')).toHaveValue('e1');
  });

  it('submits its own form rather than the details form', () => {
    // Notes have their own action now. A textarea still associated with the
    // details form would post to saveEventDetails, which no longer writes
    // notes at all -- the change would be silently discarded.
    const { container } = render(<SharedNotesSection eventId="e1" body="" />);

    expect(container.querySelector('form')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('form');
  });
});

describe('NotesSection', () => {
  it('renders the stored body', () => {
    render(<NotesSection eventId="e1" body="speech at 9pm" />);

    expect(screen.getByRole('textbox')).toHaveValue('speech at 9pm');
  });

  it('says only the dj can read it', () => {
    render(<NotesSection eventId="e1" body="" />);

    expect(screen.getByText(/only you can see this/i)).toBeInTheDocument();
  });

  it('submits its own form rather than the details form', () => {
    const { container } = render(<NotesSection eventId="e1" body="" />);

    expect(container.querySelector('form')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('form');
  });
});
