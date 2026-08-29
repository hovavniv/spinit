import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { initials } from '@/lib/dashboard/format';
import type { DjProfile } from '@/lib/dashboard/types';
import styles from './DashboardSidebar.module.css';

type NavKey = 'dashboard' | 'upcoming' | 'past';

const NAV_ITEMS: { key: NavKey; label: string; href: string }[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard' },
  { key: 'upcoming', label: 'Upcoming events', href: '/events/upcoming' },
  { key: 'past', label: 'Past events', href: '/events/past' },
];

interface DashboardSidebarProps {
  dj: DjProfile;
  /**
   * Which nav item renders as the current page — a non-link <span> with
   * aria-current, matching the artboard. Defaults to 'dashboard' so the
   * existing DashboardScreen call site is unchanged.
   */
  current?: NavKey;
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
export function DashboardSidebar({ dj, current = 'dashboard' }: DashboardSidebarProps) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.blobPink} aria-hidden="true" />
      <div className={styles.blobIndigo} aria-hidden="true" />

      <div className={styles.top}>
        <div className={styles.brandRow}>
          <Logo tone="light" size="sm" />
        </div>

        <nav aria-label="Main" className={styles.nav}>
          {NAV_ITEMS.map((item) =>
            item.key === current ? (
              <span key={item.key} className={styles.navItemCurrent} aria-current="page">
                {item.label}
              </span>
            ) : (
              <Link key={item.key} href={item.href} className={styles.navItem}>
                {item.label}
              </Link>
            ),
          )}
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
