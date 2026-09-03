import Link from 'next/link';

import { StepHeader } from '@/components/events/detail/StepHeader';
import styles from './NewEventShell.module.css';

interface NewEventShellProps {
  current: 1 | 2 | 3;
  title: string;
  children: React.ReactNode;
}

/**
 * The frame every wizard step shares: the back link, the title, the 1–2–3
 * trail, and the white card (design §4).
 *
 * A Server Component. The step forms inside it are Client Components and
 * receive their actions as props from the page -- they must never import an
 * action module themselves, because a 'use server' module pulls in the DAL's
 * `import 'server-only'`, which cannot be evaluated under jsdom.
 */
export function NewEventShell({ current, title, children }: NewEventShellProps) {
  return (
    <div className={styles.page}>
      <Link href="/dashboard" className={styles.backLink}>
        ← Back to dashboard
      </Link>

      <h1 className={styles.title}>{title}</h1>

      <StepHeader current={current} />

      <div className={styles.card}>{children}</div>
    </div>
  );
}
