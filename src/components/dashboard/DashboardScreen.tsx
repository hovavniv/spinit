import { DashboardSidebar } from './DashboardSidebar';
import { DashboardHeader } from './DashboardHeader';
import { LiveEventBanner } from './LiveEventBanner';
import { UpcomingEvents } from './UpcomingEvents';
import { PastEvents } from './PastEvents';
import type { DashboardData } from '@/lib/dashboard/types';
import styles from './DashboardScreen.module.css';

interface DashboardScreenProps {
  data: DashboardData;
}

/**
 * The whole screen, from design/artboards/Spinit DJ Dashboard.dc.html — the
 * top-level flex row (sidebar + main), composing every dashboard component.
 * Pure function of `data`; nothing here reads a clock, a route, or a store
 * (design/specs/2026-08-29-dj-dashboard-design.md §5).
 */
export function DashboardScreen({ data }: DashboardScreenProps) {
  return (
    <div className={styles.screen}>
      <DashboardSidebar dj={data.dj} />
      <div className={styles.main}>
        <div className={styles.content}>
          <DashboardHeader dj={data.dj} now={data.now} />
          {data.liveEvent !== null && <LiveEventBanner liveEvent={data.liveEvent} />}
          <UpcomingEvents events={data.upcoming} now={data.now} />
          <PastEvents events={data.past} />
        </div>
      </div>
    </div>
  );
}
