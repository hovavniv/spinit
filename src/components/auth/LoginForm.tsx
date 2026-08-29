'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Field } from './Field';
import { loginSchema } from '@/lib/validation';
import styles from './AuthForm.module.css';

interface LoginFormProps {
  onSwitchToRegister: () => void;
}

interface LoginValues {
  email: string;
  password: string;
}

type LoginErrors = Partial<Record<keyof LoginValues, string>>;

const fieldOrder: (keyof LoginValues)[] = ['email', 'password'];

/**
 * The login field set from design/artboards/Spinit DJ Login.dc.html,
 * <!-- RIGHT: FORM -->, isLogin branch. Validated through lib/validation.ts.
 * Does not submit anywhere — a valid submit shows the "not wired up yet"
 * notice from design doc section 7.
 */
export function LoginForm({ onSwitchToRegister }: LoginFormProps) {
  const [values, setValues] = useState<LoginValues>({ email: '', password: '' });
  const [errors, setErrors] = useState<LoginErrors>({});
  const [submitted, setSubmitted] = useState(false);

  function handleChange(name: keyof LoginValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    setErrors(nextErrors);

    const firstInvalid = fieldOrder.find((name) => nextErrors[name]);
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      setSubmitted(false);
      return;
    }

    setSubmitted(true);
  }

  return (
    <>
      <h2 className={styles.heading}>Welcome back</h2>
      <p className={styles.subheading}>Log in to jump into tonight&apos;s queue.</p>

      {submitted && (
        <p className={styles.notice} role="status">
          Login isn&apos;t wired up yet — this is a preview of the form.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate>
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

        <button type="submit" className={styles.submit}>
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
