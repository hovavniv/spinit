import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirects';

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
