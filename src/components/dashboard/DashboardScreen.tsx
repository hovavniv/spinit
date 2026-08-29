import type { ReactNode } from 'react';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardHeader } from './DashboardHeader';
import { LiveEventBanner } from './LiveEventBanner';
import { UpcomingEvents } from './UpcomingEvents';
import { PastEvents } from './PastEvents';
import type { DashboardData } from '@/lib/dashboard/types';
import styles from './DashboardScreen.module.css';

interface DashboardScreenProps {
  data: DashboardData;
  /**
   * The `signOut` server action, passed in rather than imported: actions.ts is
   * 'use server' and pulls in dal.ts's `import 'server-only'`, neither
   * importable from jsdom. Same pattern as CompleteProfile's `updateProfile`
   * (design §7).
   *
   * Optional: the design-preview route at `src/app/design/dashboard/page.tsx`
   * renders this component with no session to end, and every component in
   * that tree is a Server Component, so a `<form action={…}>` prop must be a
   * real server reference or the Flight serializer throws at render — a no-op
   * function does not work there. When omitted, no sign-out control renders.
   */
  signOutAction?: () => Promise<void>;
  /**
   * The "finish your profile" form, or null. Passed as a node rather than a
   * boolean so the screen never imports CompleteProfile — which would drag
   * the server action in and break every RTL test in this file (design §7).
   */
  profilePrompt?: ReactNode;
}

/**
 * The whole screen, from design/artboards/Spinit DJ Dashboard.dc.html — the
 * top-level flex row (sidebar + main), composing every dashboard component.
 * Pure function of `data`; nothing here reads a clock, a route, or a store
 * (design/specs/2026-08-29-dj-dashboard-design.md §5).
 */
export function DashboardScreen({ data, signOutAction, profilePrompt }: DashboardScreenProps) {
  return (
    <div className={styles.screen}>
      <DashboardSidebar dj={data.dj} signOutAction={signOutAction} />
      <div className={styles.main}>
        <div className={styles.content}>
          <DashboardHeader dj={data.dj} now={data.now} />
          {profilePrompt}
          {data.liveEvent !== null && <LiveEventBanner liveEvent={data.liveEvent} />}
          <UpcomingEvents events={data.upcoming} now={data.now} />
          <PastEvents events={data.past} />
        </div>
      </div>
    </div>
  );
}
