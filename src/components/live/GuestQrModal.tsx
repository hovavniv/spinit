'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './GuestQrModal.module.css';

/**
 * The Guest QR modal (design §7.2): a centred card over a blurred scrim,
 * dismissed by the backdrop, the × button, or Escape. Shows the couple's
 * names, a server-generated QR (see `src/lib/live/qr.ts`), the join URL with
 * a copy-to-clipboard pill, a link that opens the guest view, and a
 * print-table-cards control that is pure `window.print()` against the
 * `@media print` block in this module's CSS (design §7.2: not a PDF
 * generator).
 *
 * `qrSvg` is generated server-side and rendered here via
 * `dangerouslySetInnerHTML` -- safe specifically because it is produced by
 * this app's own `qrcode` library from `joinUrl`, a value this app fully
 * controls (shape-checked token + `siteUrl()`), never from unsanitized user
 * input. This is the only place in the codebase this is done, and it must
 * stay that way (CLAUDE.md).
 */
export function GuestQrModal({
  coupleNames,
  joinUrl,
  qrSvg,
  onClose,
}: {
  coupleNames: string;
  joinUrl: string;
  qrSvg: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleCopy() {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(joinUrl);
        setCopied(true);
        return;
      } catch {
        // fall through to the selection fallback below
      }
    }
    inputRef.current?.select();
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div
      className={styles.backdrop}
      data-testid="qr-modal-backdrop"
      onClick={handleBackdropClick}
    >
      <div className={styles.card} data-testid="qr-modal-card">
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          ×
        </button>

        <p className={styles.eyebrow}>Guests scan to request</p>
        <p className={styles.coupleNames}>{coupleNames}</p>
        <p className={styles.instructions}>
          Put this on the tables. No app, no login — the camera does it.
        </p>

        <div className={styles.qrWrap} dangerouslySetInnerHTML={{ __html: qrSvg }} />

        <div className={styles.urlPill}>
          <input
            ref={inputRef}
            readOnly
            className={styles.urlText}
            value={joinUrl}
            aria-label="Join URL"
          />
          <button type="button" className={styles.copyButton} onClick={() => void handleCopy()}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <div className={styles.actions}>
          <a
            className={styles.openLink}
            href={joinUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open guest view
          </a>
          <button type="button" className={styles.printButton} onClick={() => window.print()}>
            Print table cards
          </button>
        </div>
      </div>

      <div className={styles.printOnly} aria-hidden="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={styles.printCard}>
            <p className={styles.printCoupleNames}>{coupleNames}</p>
            <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
          </div>
        ))}
      </div>
    </div>
  );
}
