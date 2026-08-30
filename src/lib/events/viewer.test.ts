import { describe, expect, it } from 'vitest';

import { resolveViewer } from './viewer';
import type { PartnerRow } from './detailTypes';

const partners: PartnerRow[] = [
  { id: 'p1', slot: 1, display_name: 'Maya', user_id: 'user-maya' },
  { id: 'p2', slot: 2, display_name: 'Chris', user_id: null },
];

describe('resolveViewer', () => {
  it('calls the event owner the dj', () => {
    expect(resolveViewer('dj-1', 'dj-1', partners)).toEqual({ role: 'dj' });
  });

  it('calls a linked user a partner and names their row', () => {
    expect(resolveViewer('user-maya', 'dj-1', partners)).toEqual({
      role: 'partner',
      partnerId: 'p1',
    });
  });

  it('returns null for anyone else, so the route can 404', () => {
    expect(resolveViewer('stranger', 'dj-1', partners)).toBeNull();
  });

  it('prefers dj when the dj is somehow also a partner', () => {
    const odd: PartnerRow[] = [{ id: 'p9', slot: 1, display_name: 'X', user_id: 'dj-1' }];

    expect(resolveViewer('dj-1', 'dj-1', odd)).toEqual({ role: 'dj' });
  });

  it('ignores unclaimed slots', () => {
    // Slot 2's user_id is null -- the "invited, not yet claimed" state. A
    // null-matching bug here would make every unclaimed slot match every
    // caller whose id was somehow null.
    expect(resolveViewer('nobody', 'dj-1', partners)).toBeNull();
  });

  it('does not match an unclaimed slot against a null-ish caller', () => {
    expect(resolveViewer('', 'dj-1', partners)).toBeNull();
  });
});
