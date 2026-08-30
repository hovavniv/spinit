import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/events/notesActions', () => ({
  saveSharedNotes: vi.fn(),
  savePrivateNotes: vi.fn(),
}));

import { saveSharedNotes, savePrivateNotes } from '@/lib/events/notesActions';
import { SharedNotesSection } from './SharedNotesSection';
import { NotesSection } from './NotesSection';

describe('SharedNotesSection', () => {
  it('renders the stored body', () => {
    render(
      <SharedNotesSection eventId="e1" body="both of us agreed" saveAction={saveSharedNotes} isDj />,
    );

    expect(screen.getByRole('textbox')).toHaveValue('both of us agreed');
  });

  it('says who can read it, because the couple can', () => {
    render(<SharedNotesSection eventId="e1" body="" saveAction={saveSharedNotes} isDj />);

    expect(screen.getByText(/couple can see/i)).toBeInTheDocument();
  });

  it('carries the event id, so the action does not have to guess it', () => {
    const { container } = render(
      <SharedNotesSection eventId="e1" body="" saveAction={saveSharedNotes} isDj />,
    );

    expect(container.querySelector('input[name="eventId"]')).toHaveValue('e1');
  });

  it('submits its own form rather than the details form', () => {
    // Notes have their own action now. A textarea still associated with the
    // details form would post to saveEventDetails, which no longer writes
    // notes at all -- the change would be silently discarded.
    const { container } = render(
      <SharedNotesSection eventId="e1" body="" saveAction={saveSharedNotes} isDj />,
    );

    expect(container.querySelector('form')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('form');
  });

  it('tells the dj which box the couple reads', () => {
    render(<SharedNotesSection eventId="e1" body="" saveAction={saveSharedNotes} isDj />);

    expect(screen.getByText(/private notes above/i)).toBeInTheDocument();
  });

  it('does not point a partner at a private-notes section they do not have', () => {
    // A partner's page has no private-notes section at all -- EventDetailScreen
    // gates NotesSection on viewer.role === 'dj'. The sentence naming it would
    // point at a box that does not exist on their screen.
    render(
      <SharedNotesSection eventId="e1" body="" saveAction={saveSharedNotes} isDj={false} />,
    );

    expect(screen.queryByText(/private notes above/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couple can see/i)).toBeInTheDocument();
  });
});

describe('NotesSection', () => {
  it('renders the stored body', () => {
    render(<NotesSection eventId="e1" body="speech at 9pm" saveAction={savePrivateNotes} />);

    expect(screen.getByRole('textbox')).toHaveValue('speech at 9pm');
  });

  it('says only the dj can read it', () => {
    render(<NotesSection eventId="e1" body="" saveAction={savePrivateNotes} />);

    expect(screen.getByText(/only you can see this/i)).toBeInTheDocument();
  });

  it('submits its own form rather than the details form', () => {
    const { container } = render(
      <NotesSection eventId="e1" body="" saveAction={savePrivateNotes} />,
    );

    expect(container.querySelector('form')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('form');
  });
});
