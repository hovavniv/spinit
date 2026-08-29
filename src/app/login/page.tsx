import type { Metadata } from 'next';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { signInWithPassword, signUpWithPassword } from '@/lib/auth/actions';

export const metadata: Metadata = {
  title: 'Log in — Spinit',
  description: 'Log in to see tonight’s live requests, ranked by demand and the couple’s rules.',
};

export default function LoginPage() {
  return <AuthScreen defaultMode="login" loginAction={signInWithPassword} registerAction={signUpWithPassword} />;
}
