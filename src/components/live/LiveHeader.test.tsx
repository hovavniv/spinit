import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { LiveHeader } from './LiveHeader';

const JOIN_URL = 'https://spinit.live/join/aB3xY9kLp2QmN4rT7vW1zX';
const QR_SVG = '<svg data-testid="qr-svg"></svg>';

function renderHeader() {
  return render(
    <LiveHeader
      eventId="11111111-1111-4111-8111-111111111111"
      coupleNames="Maya & Tomer"
      venue="The Vineyard"
      eventDate="2026-09-04"
      startTime="18:00"
      now="2026-09-04T19:00:00.000Z"
      phase="dinner"
      onPhaseChange={vi.fn()}
      queueCount={0}
      mustPlayProgress={{ played: 0, total: 0 }}
      endEvent={vi.fn(async () => ({ ok: true as const }))}
      joinUrl={JOIN_URL}
      qrSvg={QR_SVG}
    />,
  );
}

describe('LiveHeader', () => {
  it('the Guest QR code button opens the QR modal', async () => {
    const user = userEvent.setup();
    renderHeader();

    expect(screen.queryByTestId('qr-modal-card')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guest QR code' }));

    expect(screen.getByTestId('qr-modal-card')).toBeInTheDocument();
  });

  it('closing the modal removes it', async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Guest QR code' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByTestId('qr-modal-card')).not.toBeInTheDocument();
  });
});
