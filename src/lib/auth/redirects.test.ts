import { describe, expect, it } from 'vitest';
import { postLoginPath, safeRedirect } from './redirects';

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
