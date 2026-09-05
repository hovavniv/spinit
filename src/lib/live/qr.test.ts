import { describe, expect, it } from 'vitest';

import { generateQrSvg } from './qr';

/**
 * A real call into the `qrcode` package -- no mocking. `qrcode` renders
 * locally with no network dependency, so this is safe and fast, and it is
 * the point of the test: proving the real library integration produces an
 * SVG string, per this branch's discipline against fixturing a third-party
 * shape from memory (CLAUDE.md).
 */
describe('generateQrSvg', () => {
  it('renders an SVG string for a given URL', async () => {
    const svg = await generateQrSvg('https://spinit.live/join/aB3xY9kLp2QmN4rT7vW1zX');

    expect(svg).toContain('<svg');
  });
});
