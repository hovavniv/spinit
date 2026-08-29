'use client';

import { useActionState, useState } from 'react';
import { Field } from './Field';
import { loginSchema } from '@/lib/validation';
import type { ActionResult } from '@/lib/auth/errors';
import styles from './AuthForm.module.css';

interface LoginFormProps {
  onSwitchToRegister: () => void;
  /**
   * `signInWithPassword` from `lib/auth/actions`, passed down from
   * `app/login/page.tsx` via `AuthScreen`. This component never imports
   * `lib/auth/actions` itself — that module pulls in `next/headers` and
   * `import 'server-only'`, neither importable from jsdom (design 6, design
   * 10.3) — so the action is always received as a prop, which is also what
   * keeps this component testable with a plain `vi.fn()`.
   */
  action: (prevState: ActionResult, formData: FormData) => Promise<ActionResult>;
  /**
   * Short, fixed copy derived from a failed `/auth/callback` redirect
   * (see `app/login/page.tsx`), shown on initial load. A `generalMessage`
   * from a real submit (`state`) takes precedence once one exists — it
   * reflects what the DJ just did, which is more relevant than a message
   * from how they arrived at the page.
   */
  callbackMessage?: string;
}

interface LoginValues {
  email: string;
  password: string;
}

type LoginErrors = Partial<Record<keyof LoginValues, string>>;

const fieldOrder: (keyof LoginValues)[] = ['email', 'password'];

// Never `{ ok: true }` — that value is reserved for a real successful submit,
// so a render can tell "just mounted" apart from "the action just succeeded".
const initialState: ActionResult = { ok: false, formErrors: {} };

/**
 * The login field set from design/artboards/Spinit DJ Login.dc.html,
 * <!-- RIGHT: FORM -->, isLogin branch. Client-validated with `loginSchema`
 * for immediate feedback, then submitted to the real server action via
 * `useActionState` (design 4.2, design 4.1's form-conversion note).
 */
export function LoginForm({ onSwitchToRegister, action, callbackMessage }: LoginFormProps) {
  const [values, setValues] = useState<LoginValues>({ email: '', password: '' });
  const [clientErrors, setClientErrors] = useState<LoginErrors>({});
  const [state, formAction, pending] = useActionState(action, initialState);

  const serverFieldErrors = !state.ok && 'formErrors' in state ? state.formErrors : {};
  const errors: LoginErrors = { ...serverFieldErrors, ...clientErrors };
  // A message from an actual submit takes precedence over the callback
  // message from how the DJ arrived here — see the prop doc comment above.
  // A message from an actual submit takes precedence over the callback
  // message from how the DJ arrived here — see the prop doc comment above.
  const generalMessage = (!state.ok && 'message' in state ? state.message : undefined) ?? callbackMessage;

  function handleChange(name: keyof LoginValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  /**
   * Passed straight to `<form action>`. Runs the client-side pre-check first
   * — invalid input never reaches the server action at all — and only calls
   * `formAction` (which invokes the real server action) once `loginSchema`
   * is satisfied.
   */
  function submitAction(formData: FormData) {
    const result = loginSchema.safeParse(values);
    const nextErrors: LoginErrors = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const name = issue.path[0] as keyof LoginValues | undefined;
        if (name && !nextErrors[name]) {
          nextErrors[name] = issue.message;
        }
      }
    }
    setClientErrors(nextErrors);

    const firstInvalid = fieldOrder.find((name) => nextErrors[name]);
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    formAction(formData);
  }

  return (
    <>
      <h2 className={styles.heading}>Welcome back</h2>
      <p className={styles.subheading}>Log in to jump into tonight&apos;s queue.</p>

      {generalMessage && (
        <p className={styles.notice} role="alert">
          {generalMessage}
        </p>
      )}

      <form action={submitAction} noValidate>
        <div className={`${styles.fields} ${styles.fieldsLogin}`}>
          <Field
            label="Email"
            name="email"
            type="email"
            placeholder="you@djcrew.com"
            value={values.email}
            onChange={(e) => handleChange('email', e.target.value)}
            error={errors.email}
          />
          <Field
            label="Password"
            name="password"
            type="password"
            placeholder="••••••••"
            value={values.password}
            onChange={(e) => handleChange('password', e.target.value)}
            error={errors.password}
          />
        </div>

        <div className={styles.forgotRow}>
          <a href="#" className={styles.forgotLink}>
            Forgot password?
          </a>
        </div>

        <button type="submit" className={styles.submit} disabled={pending}>
          Log in
        </button>
      </form>

      <p className={styles.footPrompt}>
        New here?{' '}
        <button type="button" className={styles.inlineSwitch} onClick={onSwitchToRegister}>
          Create an account
        </button>
      </p>
    </>
  );
}
