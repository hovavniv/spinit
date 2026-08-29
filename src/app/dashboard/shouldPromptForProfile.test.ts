import { describe, expect, it } from 'vitest';
import { shouldPromptForProfile } from './shouldPromptForProfile';
import type { Profile } from '@/lib/auth/dal';

// Pure predicate extracted from dashboard/page.tsx specifically so it is
// unit-testable without needing the async server component under test
// (design 10.1, design 10.3).

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    full_name: 'Test DJ',
    business_name: 'Test Business',
    phone: '+15551234567',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('shouldPromptForProfile', () => {
  it('returns true when business_name is null (Google user, profile incomplete)', () => {
    expect(shouldPromptForProfile(makeProfile({ business_name: null }))).toBe(true);
  });

  it('returns false when business_name is set (profile complete)', () => {
    expect(shouldPromptForProfile(makeProfile({ business_name: 'Test Business' }))).toBe(false);
  });

  it('returns true when profile is null (no row loaded, nothing to show)', () => {
    expect(shouldPromptForProfile(null)).toBe(true);
  });
});
