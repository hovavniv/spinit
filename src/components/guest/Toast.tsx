'use client';

import { useEffect } from 'react';

import styles from './Toast.module.css';

const AUTO_DISMISS_MS = 3500;

/**
 * A small transient confirmation banner (design §7.3). No existing Toast
 * component in this repo to mirror -- kept deliberately simple.
 *
 * `role="status"` (implies `aria-live="polite"`) so it reaches a screen
 * reader without stealing focus -- never `role="alert"`, which is
 * assertive and would interrupt.
 */
export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div className={styles.toast} role="status">
      {message}
    </div>
  );
}
