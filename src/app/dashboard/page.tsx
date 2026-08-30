import type { Metadata } from 'next';
import { requireUser, getProfile } from '@/lib/auth/dal';
import { updateProfile, signOut } from '@/lib/auth/actions';
import { DashboardScreen } from '@/components/dashboard/DashboardScreen';
import { listActiveEvents, listRecentPastEvents } from '@/lib/dashboard/dal';
import { toDashboardData } from '@/lib/dashboard/fromDb';
import { currentLocalNow } from '@/lib/dashboard/now';
import { CompleteProfile } from './CompleteProfile';
import { shouldPromptForProfile } from './shouldPromptForProfile';

export const metadata: Metadata = {
  title: 'Dashboard — Spinit',
};

/**
 * The DJ Dashboard, populated from the signed-in DJ's own rows
 * (docs/specs/2026-08-29-dashboard-data-design.md §7).
 *
 * Calls `requireUser()` directly here, not in a layout: Next's own docs warn
 * that a layout check does not re-run on client-side navigation and does not
 * block child segment rendering, so the real gate belongs in the page.
 * `getProfile()` and both DAL functions call it again themselves; every one of
 * them is React-`cache()`d, so that is one network round trip, not four.
 */
export default async function DashboardPage() {
  await requireUser();

  const [profile, activeRows, pastRows] = await Promise.all([
    getProfile(),
    listActiveEvents(),
    listRecentPastEvents(),
  ]);

  const data = toDashboardData({
    profile,
    activeRows,
    pastRows,
    now: currentLocalNow(),
  });

  return (
    <DashboardScreen
      data={data}
      signOutAction={signOut}
      profilePrompt={
        shouldPromptForProfile(profile) ? <CompleteProfile updateProfile={updateProfile} /> : null
      }
    />
  );
}
