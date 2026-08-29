import Link from 'next/link';
import styles from './SectionHeading.module.css';

interface SectionHeadingProps {
  title: string;
  viewAllLabel: string;
  viewAllHref: string;
}

/**
 * The <h2> + "View all →" row, from design/artboards/Spinit DJ Dashboard.dc.html
 * (the header of both the "upcoming-events" and "past-events" blocks). Shared
 * by UpcomingEvents and PastEvents. The visible link text "View all →" is the
 * same for both sections, so `viewAllLabel` supplies a distinct accessible
 * name per section (design/specs/2026-08-29-dj-dashboard-design.md §9) —
 * otherwise a screen-reader user listing links would hear "View all" twice
 * with no way to tell them apart.
 */
export function SectionHeading({ title, viewAllLabel, viewAllHref }: SectionHeadingProps) {
  return (
    <div className={styles.heading}>
      <h2 className={styles.title}>{title}</h2>
      <Link href={viewAllHref} aria-label={viewAllLabel} className={styles.viewAll}>
        View all →
      </Link>
    </div>
  );
}
