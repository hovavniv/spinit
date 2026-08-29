import type { Metadata } from 'next';
import { requireUser, getProfile } from '@/lib/auth/dal';
import { updateProfile, signOut } from '@/lib/auth/actions';
import { CompleteProfile } from './CompleteProfile';
import { shouldPromptForProfile } from './shouldPromptForProfile';

export const metadata: Metadata = {
  title: 'Dashboard — Spinit',
};

/**
 * A protected placeholder proving the session, the route guard, and RLS work
 * (design 1). The real DJ Dashboard artboard is a later chunk — this stays
 * minimal and functional rather than trying to match any specific visual
 * design.
 *
 * Calls `requireUser()` directly here, not in a layout: Next's own docs warn
 * that a layout check does not re-run on client-side navigation and does not
 * block child segment rendering, so the real gate belongs in the page
 * (design 3).
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const profile = await getProfile();

  return (
    <main>
      <h1>Welcome, {profile?.full_name || user.email}</h1>
      <p>Signed in as {user.email}</p>

      {shouldPromptForProfile(profile) ? (
        <CompleteProfile updateProfile={updateProfile} />
      ) : (
        <section>
          <h2>Your profile</h2>
          <dl>
            <dt>Business name</dt>
            <dd>{profile?.business_name}</dd>
            <dt>Phone</dt>
            <dd>{profile?.phone}</dd>
          </dl>
        </section>
      )}

      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
