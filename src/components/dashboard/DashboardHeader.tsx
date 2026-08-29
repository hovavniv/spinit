import Link from 'next/link';
import { formatEyebrowDate, greeting, firstName } from '@/lib/dashboard/format';
import type { DjProfile } from '@/lib/dashboard/types';
import styles from './DashboardHeader.module.css';

interface DashboardHeaderProps {
  dj: DjProfile;
  now: string;
}

/**
 * The header row, from design/artboards/Spinit DJ Dashboard.dc.html — the
 * eyebrow date, greeting h1, and "+ New event" button (flex row, first
 * child of the main column).
 */
export function DashboardHeader({ dj, now }: DashboardHeaderProps) {
  return (
    <div className={styles.header}>
      <div>
        <div className={styles.eyebrow}>{formatEyebrowDate(now)}</div>
        <h1 className={styles.greeting}>
          {greeting(now)}, {firstName(dj.name)}
        </h1>
      </div>
      <Link href="/events/new" className={styles.newEvent}>
        + New event
      </Link>
    </div>
  );
}
