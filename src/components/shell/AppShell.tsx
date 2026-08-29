import type { ReactNode } from 'react';
import styles from './AppShell.module.css';

interface AppShellProps {
  /** The dark rail. Passed in rather than imported so the shell stays layout-only. */
  sidebar: ReactNode;
  children: ReactNode;
}

/**
 * The sidebar + padded main column + 1040px inner wrapper, from
 * design/artboards/Spinit Past Events.dc.html (the top-level flex row).
 *
 * `sidebar` is a prop rather than an import so this file has no opinion about
 * which rail it renders, and so a server-rendered sidebar can sit inside a
 * tree that also contains client components.
 */
export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className={styles.screen}>
      {sidebar}
      <div className={styles.main}>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
