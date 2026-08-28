'use client';

import { useEffect } from 'react';
import styles from './error.module.css';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={styles.container}>
      <h1 className={styles.heading}>Something went wrong</h1>
      <p className={styles.description}>
        We encountered an unexpected error. Try refreshing the page or contact support if the problem persists.
      </p>
      <button onClick={reset} className={styles.button}>
        Try again
      </button>
    </main>
  );
}
