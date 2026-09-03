import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StepHeader } from './StepHeader';

describe('StepHeader', () => {
  test('draws all three steps', () => {
    render(<StepHeader />);

    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Invite')).toBeInTheDocument();
    expect(screen.getByText('Streaming')).toBeInTheDocument();
  });

  test('renders no links — steps 1 and 2 are inert on an existing event', () => {
    // Pointing them at routes that do not exist would be worse than pointing
    // them nowhere (design §2.4).
    const { container } = render(<StepHeader />);

    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  test('marks the current step for assistive technology', () => {
    render(<StepHeader current={1} />);

    expect(screen.getByText('1')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('2')).not.toHaveAttribute('aria-current');
  });

  test('defaults to step 3, leaving the event page unchanged', () => {
    render(<StepHeader />);

    expect(screen.getByText('3')).toHaveAttribute('aria-current', 'step');
  });
});
