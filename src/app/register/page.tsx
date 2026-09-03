import type { Metadata } from 'next';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { signInWithPassword, signUpWithPassword } from '@/lib/auth/actions';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Register — Spinit',
  description:
    'Create a Spinit account to set up your first event and connect the couple’s streaming profile.',
};

interface RegisterPageProps {
  searchParams: Promise<{ invite?: string; slot?: string }>;
}

/**
 * Partner mode is driven by ?invite={eventId}&slot={1|2}, which a partner
 * reaches from the "Create an account" link on their claim page.
 *
 * The pair is validated HERE and again inside signUpWithPassword. This check
 * decides what to render; that one decides what to store, and a hidden field
 * is attacker-controlled either way (design §4.6).
 *
 * This page does NOT set the cookie: cookies().set() throws in a Server
 * Component. The action sets it at signup, which is also the only moment it
 * is needed.
 */
export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const { invite, slot } = await searchParams;

  const invitePath =
    invite && isUuid(invite) && (slot === '1' || slot === '2')
      ? `/invite/${invite}/${slot}`
      : null;

  return (
    <AuthScreen
      defaultMode="register"
      loginAction={signInWithPassword}
      registerAction={signUpWithPassword}
      invitePath={invitePath}
    />
  );
}
