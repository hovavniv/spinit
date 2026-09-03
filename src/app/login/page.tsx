import type { Metadata } from 'next';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { signInWithPassword, signUpWithPassword } from '@/lib/auth/actions';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Log in — Spinit',
  description: 'Log in to see tonight’s live requests, ranked by demand and the couple’s rules.',
};

// The two reason codes `/auth/callback/route.ts` redirects here with on a
// failed email confirmation or OAuth exchange. Mapped to short, fixed copy —
// `searchParams.error` itself is never rendered, only ever one of these two
// known strings (or nothing), matching route.ts's own discipline around
// never rendering remote-supplied text.
const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  confirmation_failed: "That confirmation link didn't work. It may have expired — try signing up again.",
  confirmation_failed_same_browser: 'Open the confirmation link in the same browser you used to sign up.',
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string; invite?: string; slot?: string }>;
}

/**
 * Partner mode is driven by ?invite={eventId}&slot={1|2}, reached from the
 * "Log in" link on the invite claim page when the visitor is signed out
 * (design §4.4, §9.3, closed). Validated the same way /register/page.tsx
 * validates it; `LoginForm` carries it through as a hidden field so
 * `signInWithPassword` can redirect straight back here on success instead of
 * always landing on `postLoginPath`'s destination.
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, invite, slot } = await searchParams;
  const callbackMessage = error ? (CALLBACK_ERROR_MESSAGES[error] ?? CALLBACK_ERROR_MESSAGES.confirmation_failed) : undefined;

  const invitePath =
    invite && isUuid(invite) && (slot === '1' || slot === '2')
      ? `/invite/${invite}/${slot}`
      : null;

  return (
    <AuthScreen
      defaultMode="login"
      loginAction={signInWithPassword}
      registerAction={signUpWithPassword}
      callbackMessage={callbackMessage}
      invitePath={invitePath}
    />
  );
}
