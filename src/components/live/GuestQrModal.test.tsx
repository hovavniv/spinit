import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { GuestQrModal } from './GuestQrModal';

const JOIN_URL = 'https://spinit.live/join/aB3xY9kLp2QmN4rT7vW1zX';
const QR_SVG = '<svg data-testid="qr-svg"></svg>';

function setup(onClose = vi.fn()) {
  const utils = render(
    <GuestQrModal
      coupleNames="Maya & Tomer"
      joinUrl={JOIN_URL}
      qrSvg={QR_SVG}
      onClose={onClose}
    />,
  );
  return { onClose, ...utils };
}

describe('GuestQrModal', () => {
  const originalClipboard = navigator.clipboard;
  const originalPrint = window.print;

  beforeEach(() => {
    window.print = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });
    window.print = originalPrint;
  });

  it('renders the couple names and the full join URL text', () => {
    setup();
    const card = within(screen.getByTestId('qr-modal-card'));
    expect(card.getByText('Maya & Tomer')).toBeInTheDocument();
    expect(card.getByDisplayValue(JOIN_URL)).toBeInTheDocument();
  });

  it('renders the server-generated QR svg', () => {
    setup();
    const card = within(screen.getByTestId('qr-modal-card'));
    expect(card.getByTestId('qr-svg')).toBeInTheDocument();
  });

  it('Copy link calls clipboard.writeText with the exact join URL and flips its label to Copied', async () => {
    // userEvent.setup() unconditionally installs its own real Clipboard stub
    // on navigator.clipboard (see attachClipboardStubToView in
    // @testing-library/user-event), so the mock must be installed AFTER
    // setup() runs or setup() clobbers it.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    setup();

    const card = within(screen.getByTestId('qr-modal-card'));
    const copyButton = card.getByRole('button', { name: 'Copy link' });
    await user.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(JOIN_URL);
    expect(await card.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('the × button calls onClose', async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop calls onClose', () => {
    const { onClose } = setup();

    fireEvent.click(screen.getByTestId('qr-modal-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking inside the card does not call onClose', async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    const card = within(screen.getByTestId('qr-modal-card'));
    await user.click(card.getByText('Maya & Tomer'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape closes the modal', () => {
    const { onClose } = setup();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Open guest view is a link with href equal to the join URL', () => {
    setup();
    const link = screen.getByRole('link', { name: 'Open guest view' });
    expect(link).toHaveAttribute('href', JOIN_URL);
  });

  it('Print table cards calls window.print', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Print table cards' }));

    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
