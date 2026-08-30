import type { ReactNode } from 'react';
import styles from './AppShell.module.css';

interface AppShellProps {
  /** The dark rail. Passed in rather than imported so the shell stays layout-only. */
  sidebar: ReactNode;
  /**
   * Which artboard's main-column measurements to use.
   *
   * 'wide'   — Past events: 48px 56px padding, 1040px wrapper.
   * 'narrow' — Event recap: 56px padding, 760px wrapper.
   *
   * Defaults to 'wide' so the existing Past events call site is unchanged.
   */
  width?: 'wide' | 'narrow';
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
export function AppShell({ sidebar, width = 'wide', children }: AppShellProps) {
  const narrow = width === 'narrow';

  return (
    <div className={styles.screen}>
      {sidebar}
      <div className={narrow ? `${styles.main} ${styles.mainNarrow}` : styles.main}>
        <div className={narrow ? `${styles.content} ${styles.contentNarrow}` : styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}
