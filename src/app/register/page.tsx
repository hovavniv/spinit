import type { Metadata } from 'next';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { signInWithPassword, signUpWithPassword } from '@/lib/auth/actions';

export const metadata: Metadata = {
  title: 'Register — Spinit',
  description: 'Create a Spinit account to set up your first event and connect the couple’s streaming profile.',
};

export default function RegisterPage() {
  return (
    <AuthScreen defaultMode="register" loginAction={signInWithPassword} registerAction={signUpWithPassword} />
  );
}
