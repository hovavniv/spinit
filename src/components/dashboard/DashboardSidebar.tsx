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
  /**
   * The `signOut` server action, passed in rather than imported: actions.ts
   * is 'use server' and pulls in dal.ts's `import 'server-only'`, neither
   * importable from jsdom. Optional — the design-preview route has no
   * session to end and passes nothing (design §7).
   */
  signOutAction?: () => Promise<void>;
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
export function DashboardSidebar({
  dj,
  current = 'dashboard',
  signOutAction,
}: DashboardSidebarProps) {
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

      {signOutAction !== undefined && (
        // The artboard has no sign-out control anywhere — not in the rail,
        // not in the avatar chip. The page this slice rewrites held the
        // application's only one, so shipping the artboard as drawn would
        // leave a signed-in DJ with no way out. An addition to the design,
        // not an interpretation of it (design §7).
        //
        // The action is the existing one from lib/auth/actions.ts, which
        // already chooses `scope: 'local'` and already has tests. A second
        // implementation would be a second place for that scope decision to
        // drift, and whether other devices stay signed in is
        // security-relevant.
        //
        // Optional and conditionally rendered: the design-preview route has
        // no session to end and passes no action at all, rather than a no-op
        // — every component in this tree is a Server Component, and a
        // `<form action={…}>` prop that is not a real server reference throws
        // at render in the Flight serializer.
        <form action={signOutAction} className={styles.signOutForm}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      )}

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
