import type { Metadata } from 'next';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { signInWithPassword, signUpWithPassword } from '@/lib/auth/actions';

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
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const callbackMessage = error ? (CALLBACK_ERROR_MESSAGES[error] ?? CALLBACK_ERROR_MESSAGES.confirmation_failed) : undefined;

  return (
    <AuthScreen
      defaultMode="login"
      loginAction={signInWithPassword}
      registerAction={signUpWithPassword}
      callbackMessage={callbackMessage}
    />
  );
}
