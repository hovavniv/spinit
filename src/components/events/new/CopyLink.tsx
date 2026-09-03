'use client';

import { useState } from 'react';

import styles from './CopyLink.module.css';

interface CopyLinkProps {
  label: string;
  url: string;
}

/**
 * One invitation link (design §4.3).
 *
 * 'use client' because it needs an onClick, and an onClick in a Server
 * Component is a build error.
 *
 * The URL is rendered as SELECTABLE TEXT as well as a Copy button.
 * navigator.clipboard is unavailable over plain HTTP and can be denied by
 * permission, so the visible URL is what actually makes this screen work; the
 * button is a convenience on top of it.
 */
export function CopyLink({ label, url }: CopyLinkProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Denied or unavailable. The URL is on screen either way, so there is
      // nothing to recover from and nothing worth alarming the DJ about.
      setCopied(false);
    }
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <code className={styles.url}>{url}</code>
      <button type="button" onClick={copy} className={styles.button}>
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}
