import { describe, expect, it } from 'vitest';
import { invitePathFromMetadata, postLoginPath, safeRedirect } from './redirects';

describe('safeRedirect', () => {
  it('accepts /dashboard', () => {
    expect(safeRedirect('/dashboard')).toBe('/dashboard');
  });

  it('falls back to /dashboard for an absolute attacker URL', () => {
    expect(safeRedirect('https://evil.com')).toBe('/dashboard');
  });

  it('falls back to /dashboard for a protocol-relative URL', () => {
    expect(safeRedirect('//evil.com')).toBe('/dashboard');
  });

  it('falls back to /dashboard for a path-traversal attempt', () => {
    expect(safeRedirect('/dashboard/../../admin')).toBe('/dashboard');
  });

  it('falls back to /dashboard for null', () => {
    expect(safeRedirect(null)).toBe('/dashboard');
  });
});

const UUID = '0189c3a1-4b2e-7f3a-9c8d-1e2f3a4b5c6d';
const SITE = 'https://spinit.example.com';

describe('safeRedirect — invite paths', () => {
  it.each([
    [`/invite/${UUID}/1`],
    [`/invite/${UUID}/2`],
  ])('admits the valid invite path %s', (path) => {
    expect(safeRedirect(path)).toBe(path);
  });

  it.each([
    ['a protocol-relative host', '//evil.com'],
    ['an absolute URL', 'https://evil.com'],
    ['a slot outside 1 and 2', `/invite/${UUID}/3`],
    ['a non-uuid event id', '/invite/not-a-uuid/1'],
    ['a query string', `/invite/${UUID}/1?x=1`],
    ['a fragment', `/invite/${UUID}/1#f`],
    ['a traversal', `/dashboard/../invite/${UUID}/1`],
    ['a percent-encoded host', '/invite/%2F%2Fevil.com%2Fxxxxxxxxxxxxxxxxxx/1'],
    ['a trailing newline', `/invite/${UUID}/1\n`],
    ['a leading tab', `\t/invite/${UUID}/1`],
    ['36 hyphens where a uuid belongs', '/invite/------------------------------------/1'],
  ])('rejects %s', (_label, raw) => {
    expect(safeRedirect(raw)).toBe('/dashboard');
  });

  it('every rejected value still resolves to this site\'s own origin', () => {
    // The assertion that matters: safeRedirect's output is fed to
    // `new URL(result, siteUrl())`, so what must be true is that no input can
    // reach another origin -- not merely that the returned string looks safe.
    for (const raw of ['//evil.com', 'https://evil.com', `/invite/${UUID}/1?x=1`]) {
      expect(new URL(safeRedirect(raw), SITE).origin).toBe(SITE);
    }
  });
});

describe('postLoginPath', () => {
  it('sends a DJ to the dashboard', () => {
    expect(postLoginPath({ ownsEvents: true, isPartner: false })).toBe('/dashboard');
  });

  it('sends a partner who owns no events to /my-event', () => {
    expect(postLoginPath({ ownsEvents: false, isPartner: true })).toBe('/my-event');
  });

  it('sends a user who is both to the dashboard', () => {
    expect(postLoginPath({ ownsEvents: true, isPartner: true })).toBe('/dashboard');
  });

  it('sends a user who is neither to the dashboard, which explains itself', () => {
    expect(postLoginPath({ ownsEvents: false, isPartner: false })).toBe('/dashboard');
  });
});

/**
 * The reader for the invite path a partner's own account remembers
 * (2026-09-06). Its inputs are two kinds of untrusted: the metadata object
 * comes off a Supabase User and may be any shape at all, and its `invite_path`
 * is user-writable via `auth.updateUser`.
 */
describe('invitePathFromMetadata', () => {
  it('returns a valid invite path', () => {
    expect(invitePathFromMetadata({ invite_path: `/invite/${UUID}/2` })).toBe(`/invite/${UUID}/2`);
  });

  it('returns null, not /dashboard, when there is nothing usable', () => {
    // The distinction matters: a caller that treated '/dashboard' as a real
    // destination would jump the queue ahead of postLoginPath and send a
    // partner who HAS claimed to the dashboard instead of /my-event.
    expect(invitePathFromMetadata({ invite_path: '' })).toBeNull();
    expect(invitePathFromMetadata({ full_name: 'A Partner' })).toBeNull();
    expect(invitePathFromMetadata({})).toBeNull();
  });

  it('returns null for a metadata object that is missing or not an object', () => {
    expect(invitePathFromMetadata(undefined)).toBeNull();
    expect(invitePathFromMetadata(null)).toBeNull();
    expect(invitePathFromMetadata('nope')).toBeNull();
    expect(invitePathFromMetadata(42)).toBeNull();
  });

  it('returns null for a non-string invite_path', () => {
    expect(invitePathFromMetadata({ invite_path: { toString: () => `/invite/${UUID}/1` } })).toBeNull();
    expect(invitePathFromMetadata({ invite_path: [`/invite/${UUID}/1`] })).toBeNull();
    expect(invitePathFromMetadata({ invite_path: 7 })).toBeNull();
  });

  it('rejects every value safeRedirect rejects, since updateUser can set any of them', () => {
    for (const raw of [
      '//evil.com',
      'https://evil.com',
      '/dashboard',
      `/invite/${UUID}/3`,
      `/invite/${UUID}/1?x=1`,
      '/invite/not-a-uuid/1',
      `/invite/${UUID}/1/../../admin`,
    ]) {
      expect(invitePathFromMetadata({ invite_path: raw })).toBeNull();
    }
  });

  it('every returned value resolves to this site\'s own origin', () => {
    // Same assertion safeRedirect's own suite makes, repeated here because
    // this function is a second entry point into the same URL construction.
    const path = invitePathFromMetadata({ invite_path: `/invite/${UUID}/1` });
    expect(path).not.toBeNull();
    expect(new URL(path!, SITE).origin).toBe(SITE);
  });
});
