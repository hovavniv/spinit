import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  test('renders the value and the label', () => {
    render(<StatTile label="Songs played" value={10} />);

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Songs played')).toBeInTheDocument();
  });

  test('renders a string value', () => {
    render(<StatTile label="Most active guest" value="Dana R." />);
    expect(screen.getByText('Dana R.')).toBeInTheDocument();
  });

  test('renders zero rather than treating it as absent', () => {
    render(<StatTile label="Songs played" value={0} />);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  test('with no value it renders an em-dash and the reason, readably', () => {
    render(<StatTile label="Party length" pendingReason="Play times are not recorded yet." />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Play times are not recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('Party length')).toBeInTheDocument();
  });
});
