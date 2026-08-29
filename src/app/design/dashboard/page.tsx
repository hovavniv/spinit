import { notFound } from 'next/navigation';
import { DashboardScreen } from '@/components/dashboard/DashboardScreen';
import { demoData } from '@/lib/dashboard/demoData';

/**
 * Throwaway preview route for DashboardScreen, so the screen can actually be
 * looked at in a browser before auth lands (design/specs/2026-08-29-dj-dashboard-design.md
 * §2/§4). Deleted once `src/app/dashboard/page.tsx` takes over on the auth
 * branch — no component changes needed at that point.
 *
 * Never ships on the public Vercel URL: production requests 404 via the
 * app's existing styled not-found page.
 */
export default function DesignDashboardPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <DashboardScreen data={demoData} />;
}
