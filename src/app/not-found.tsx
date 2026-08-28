import Link from 'next/link';
import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <main className={styles.container}>
      <h1 className={styles.heading}>Page not found</h1>
      <p className={styles.description}>
        Sorry, we couldn&apos;t find the page you&apos;re looking for. Let&apos;s get you back on track.
      </p>
      <Link href="/" className={styles.link}>
        Return to home
      </Link>
    </main>
  );
}
