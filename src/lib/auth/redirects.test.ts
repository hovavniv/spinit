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
