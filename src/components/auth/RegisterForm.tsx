'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Field } from './Field';
import { validateRegister } from '@/lib/validation';
import type { RegisterErrors, RegisterValues } from '@/lib/validation';
import styles from './AuthForm.module.css';

interface RegisterFormProps {
  onSwitchToLogin: () => void;
}

// The dial-code options, verbatim and in order, from
// design/artboards/Spinit DJ Login.dc.html, <!-- RIGHT: FORM -->, isRegister
// branch. Do not reorder or add to this list without re-checking the artboard.
const dialCodes = ['🇺🇸 +1', '🇬🇧 +44', '🇨🇦 +1', '🇦🇺 +61', '🇮🇱 +972', '🇮🇪 +353', '🇩🇪 +49', '🇫🇷 +33'];

const fieldOrder: (keyof RegisterValues)[] = [
  'name',
  'businessName',
  'email',
  'confirmEmail',
  'phone',
  'password',
  'confirmPassword',
];

const emptyValues: RegisterValues = {
  name: '',
  businessName: '',
  email: '',
  confirmEmail: '',
  phone: '',
  password: '',
  confirmPassword: '',
};

/**
 * The register field set from design/artboards/Spinit DJ Login.dc.html,
 * <!-- RIGHT: FORM -->, isRegister branch. Validated through lib/validation.ts.
 * A failed submit shows errors but never clears the fields the DJ already
 * typed. Does not submit anywhere — a valid submit shows the "not wired up
 * yet" notice from design doc section 7.
 */
export function RegisterForm({ onSwitchToLogin }: RegisterFormProps) {
  const [values, setValues] = useState<RegisterValues>(emptyValues);
  const [dialCode, setDialCode] = useState(dialCodes[0]);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [submitted, setSubmitted] = useState(false);

  function handleChange(name: keyof RegisterValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateRegister(values);
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
      <h2 className={styles.heading}>Set up your account</h2>
      <p className={styles.subheading}>
        Takes about two minutes. You&apos;ll connect your first couple&apos;s streaming profile next.
      </p>

      {submitted && (
        <p className={styles.notice} role="status">
          Registration isn&apos;t wired up yet — this is a preview of the form.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className={styles.fields}>
          <Field
            label="Your name"
            name="name"
            type="text"
            placeholder="Jordan Ellis"
            value={values.name}
            onChange={(e) => handleChange('name', e.target.value)}
            error={errors.name}
          />
          <Field
            label="DJ business name"
            name="businessName"
            type="text"
            placeholder="Ellis Sound Co."
            value={values.businessName}
            onChange={(e) => handleChange('businessName', e.target.value)}
            error={errors.businessName}
          />
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
            label="Confirm email"
            name="confirmEmail"
            type="email"
            placeholder="you@djcrew.com"
            value={values.confirmEmail}
            onChange={(e) => handleChange('confirmEmail', e.target.value)}
            error={errors.confirmEmail}
          />
          <div className={styles.phoneField}>
            <span className={styles.phoneLabel} id="phone-label">
              Phone number
            </span>
            <div className={styles.phoneRow}>
              <select
                className={styles.dialCode}
                aria-label="Dial code"
                value={dialCode}
                onChange={(e) => setDialCode(e.target.value)}
              >
                {dialCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <div className={styles.phoneInputWrap}>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={values.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  className={`${styles.phoneInput} ${errors.phone ? styles.phoneInputInvalid : ''}`}
                  aria-labelledby="phone-label"
                  aria-invalid={!!errors.phone}
                  aria-describedby={errors.phone ? 'phone-error' : undefined}
                />
              </div>
            </div>
            {errors.phone && (
              <span id="phone-error" role="alert" className={styles.phoneError}>
                {errors.phone}
              </span>
            )}
          </div>
          <Field
            label="Password"
            name="password"
            type="password"
            placeholder="At least 8 characters"
            value={values.password}
            onChange={(e) => handleChange('password', e.target.value)}
            error={errors.password}
          />
          <Field
            label="Confirm password"
            name="confirmPassword"
            type="password"
            placeholder="At least 8 characters"
            value={values.confirmPassword}
            onChange={(e) => handleChange('confirmPassword', e.target.value)}
            error={errors.confirmPassword}
          />
        </div>

        <button type="submit" className={styles.submit}>
          Create account
        </button>
      </form>

      <p className={styles.footPrompt}>
        Already have an account?{' '}
        <button type="button" className={styles.inlineSwitch} onClick={onSwitchToLogin}>
          Log in
        </button>
      </p>
    </>
  );
}
