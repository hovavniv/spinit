import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GenrePicker } from './GenrePicker';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

describe('GenrePicker', () => {
  it('filters the vocabulary as you type', async () => {
    render(<GenrePicker valueName="value" />);
    await user.type(screen.getByRole('combobox'), 'mizr');
    expect(await screen.findByText('mizrahi')).toBeInTheDocument();
    expect(screen.queryByText('disco')).not.toBeInTheDocument();
  });

  it('cannot submit free text that is not in the vocabulary', async () => {
    const { container } = render(<GenrePicker valueName="value" />);
    await user.type(screen.getByRole('combobox'), 'not-a-real-genre');
    expect(container.querySelector('input[name="value"]')).toHaveValue('');
  });

  it('says "Common genres", never "Searching Spotify"', async () => {
    render(<GenrePicker valueName="value" />);
    await user.type(screen.getByRole('combobox'), 'pop');
    expect(await screen.findByText(/common genres/i)).toBeInTheDocument();
    expect(screen.queryByText(/searching spotify/i)).not.toBeInTheDocument();
  });

  it('writes the normalised token, so r&b becomes rnb', async () => {
    const { container } = render(<GenrePicker valueName="value" />);
    await user.type(screen.getByRole('combobox'), 'r&b');
    await user.click(await screen.findByText('rnb'));
    expect(container.querySelector('input[name="value"]')).toHaveValue('rnb');
  });

  it('offers genres only, never origins or eras', async () => {
    render(<GenrePicker valueName="value" />);
    await user.type(screen.getByRole('combobox'), 'isr');
    expect(screen.queryByText('israeli')).not.toBeInTheDocument();
    expect(await screen.findByText('israeli pop')).toBeInTheDocument();
  });

  it('can clear a picked genre via the chip', async () => {
    const { container } = render(<GenrePicker valueName="value" />);
    await user.type(screen.getByRole('combobox'), 'disco');
    await user.click(await screen.findByText('disco'));
    expect(container.querySelector('input[name="value"]')).toHaveValue('disco');
    await user.click(screen.getByLabelText(/clear selection/i));
    expect(container.querySelector('input[name="value"]')).toHaveValue('');
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
