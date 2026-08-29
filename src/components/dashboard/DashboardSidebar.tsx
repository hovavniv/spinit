import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { initials } from '@/lib/dashboard/format';
import type { DjProfile } from '@/lib/dashboard/types';
import styles from './DashboardSidebar.module.css';

interface DashboardSidebarProps {
  dj: DjProfile;
}

/**
 * The dark 240px rail, from design/artboards/Spinit DJ Dashboard.dc.html,
 * the sidebar block (first child of the top-level flex row).
 *
 * DOM is deliberately two children of the root — `[wrapper containing logo +
 * nav]` and `[avatar chip]` — so Task 9's mobile collapse can flex-row the
 * wrapper independently of the sidebar itself
 * (design/specs/2026-08-29-dj-dashboard-design.md §8).
 */
export function DashboardSidebar({ dj }: DashboardSidebarProps) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.blobPink} aria-hidden="true" />
      <div className={styles.blobIndigo} aria-hidden="true" />

      <div className={styles.top}>
        <div className={styles.brandRow}>
          <Logo tone="light" size="sm" />
        </div>

        <nav aria-label="Main" className={styles.nav}>
          <span className={styles.navItemCurrent} aria-current="page">
            Dashboard
          </span>
          <Link href="/events/upcoming" className={styles.navItem}>
            Upcoming events
          </Link>
          <Link href="/events/past" className={styles.navItem}>
            Past events
          </Link>
        </nav>
      </div>

      <div className={styles.chip}>
        <div className={styles.avatar}>{initials(dj.name)}</div>
        <div className={styles.chipText}>
          <div className={styles.chipName}>{dj.name}</div>
          <div className={styles.chipCompany}>{dj.company}</div>
        </div>
      </div>
    </div>
  );
}
