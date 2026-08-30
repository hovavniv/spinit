import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecapHeader } from './RecapHeader';
import type { RecapEvent } from '@/lib/events/types';

const EVENT: RecapEvent = {
  id: 'noa',
  couple_names: 'Noa & Eitan',
  venue: 'Franklin Hall',
  event_date: '2026-07-18',
};

describe('RecapHeader', () => {
  test('renders the couple as the heading', () => {
    render(<RecapHeader event={EVENT} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Noa & Eitan');
  });

  test('renders the date and venue', () => {
    render(<RecapHeader event={EVENT} />);
    expect(screen.getByText('July 18, 2026 · Franklin Hall')).toBeInTheDocument();
  });

  test('renders the Completed eyebrow', () => {
    render(<RecapHeader event={EVENT} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  test('the back link points at Past events, not the dashboard', () => {
    render(<RecapHeader event={EVENT} />);
    expect(screen.getByRole('link', { name: /back to past events/i })).toHaveAttribute(
      'href',
      '/events/past',
    );
  });

  // The whole reason this file exists. aria-disabled rather than `disabled`
  // keeps the button focusable, which is what makes the explanation
  // reachable by keyboard at all -- a `disabled` button cannot be tabbed to,
  // so anything inside it is unreachable too.
  test('the Send button is marked disabled but stays focusable', () => {
    render(<RecapHeader event={EVENT} />);
    const button = screen.getByRole('button', { name: /send to couple/i });

    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
  });

  test('the Send button explains why it does nothing', () => {
    render(<RecapHeader event={EVENT} />);
    expect(screen.getByRole('button', { name: /send to couple/i })).toHaveAccessibleDescription(
      /coming soon/i,
    );
  });
});
