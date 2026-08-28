import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HeroPhoneDemo } from './HeroPhoneDemo';
import { hotRequests, seedSongs, sortByVotes } from '@/lib/heroDemo';

describe('HeroPhoneDemo', () => {
  it('shows the guest view first, with the seeded songs sorted by votes descending', () => {
    render(<HeroPhoneDemo />);

    const expectedOrder = sortByVotes(seedSongs).map((s) => s.title);
    const rows = screen.getAllByRole('button', { name: /^Vote for /i });
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(
      expectedOrder.map((title) => `Vote for ${title}`),
    );
  });

  it('increments the third song in current order by one vote when its vote button is clicked', async () => {
    const user = userEvent.setup();
    render(<HeroPhoneDemo />);

    const sorted = sortByVotes(seedSongs);
    const third = sorted[2];
    const voteButton = screen.getByRole('button', { name: `Vote for ${third.title}` });

    await user.click(voteButton);

    const row = voteButton.closest('div');
    expect(row?.textContent).toContain(String(third.votes + 1));
  });

  it('switches to the DJ view and lists the three ranked hot requests', async () => {
    const user = userEvent.setup();
    render(<HeroPhoneDemo />);

    await user.click(screen.getByRole('tab', { name: 'DJ view' }));

    for (const req of hotRequests) {
      expect(screen.getByText(req.title)).toBeInTheDocument();
      expect(screen.getByText(`${req.requests} requests`)).toBeInTheDocument();
    }
    expect(screen.queryByText(seedSongs[0].artist)).not.toBeInTheDocument();
  });

  it('expands one hot request explanation at a time', async () => {
    const user = userEvent.setup();
    render(<HeroPhoneDemo />);

    await user.click(screen.getByRole('tab', { name: 'DJ view' }));

    const first = screen.getByRole('button', { name: new RegExp(hotRequests[0].title) });
    const second = screen.getByRole('button', { name: new RegExp(hotRequests[1].title) });

    await user.click(first);
    expect(screen.getByText(hotRequests[0].why)).toBeInTheDocument();

    await user.click(second);
    expect(screen.queryByText(hotRequests[0].why)).not.toBeInTheDocument();
    expect(screen.getByText(hotRequests[1].why)).toBeInTheDocument();
  });
});
