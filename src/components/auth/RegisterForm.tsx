'use client';

import { useActionState, useState } from 'react';
import { Field } from './Field';
import { registerSchema, partnerRegisterSchema } from '@/lib/validation';
import type { ActionResult } from '@/lib/auth/errors';
import styles from './AuthForm.module.css';

interface RegisterValues {
  name: string;
  businessName: string;
  email: string;
  confirmEmail: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

type RegisterErrors = Partial<Record<keyof RegisterValues, string>>;

interface RegisterFormProps {
  onSwitchToLogin: () => void;
  /**
   * `signUpWithPassword` from `lib/auth/actions`, passed down from
   * `app/register/page.tsx` via `AuthScreen`. This component never imports
   * `lib/auth/actions` itself — see the same note in `LoginForm.tsx` (design
   * 6, design 10.3).
   */
  action: (prevState: ActionResult, formData: FormData) => Promise<ActionResult>;
  /**
   * Non-null only when the visitor arrived from an invitation
   * (`/register?invite={eventId}&slot={1|2}`, resolved by
   * `app/register/page.tsx`). Hides the two DJ-only fields (business name,
   * phone) and carries the invite through the signup as two hidden inputs, so
   * `/auth/callback` can send the new partner straight to their claim page
   * (design §4.6-§4.8).
   */
  invitePath?: string | null;
}

/**
 * The dial-code options from design/artboards/Spinit DJ Login.dc.html,
 * <!-- RIGHT: FORM -->, isRegister branch. `value` is the bare dial code —
 * what actually reaches `FormData` and the joined `${dialCode}${phone}`
 * string the server validates against the SQL `phone_fmt` shape (design 4.1
 * step 4); `label` carries the flag emoji so the rendered appearance in the
 * artboard is unchanged. US and Canada intentionally share the value `+1`.
 */
const dialCodes = [
  { value: '+1', label: '🇺🇸 +1' },
  { value: '+44', label: '🇬🇧 +44' },
  { value: '+1', label: '🇨🇦 +1' },
  { value: '+61', label: '🇦🇺 +61' },
  { value: '+972', label: '🇮🇱 +972' },
  { value: '+353', label: '🇮🇪 +353' },
  { value: '+49', label: '🇩🇪 +49' },
  { value: '+33', label: '🇫🇷 +33' },
];

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

// Never `{ ok: true }` — that value is reserved for a real successful submit
// (the "check your email" state), so a render can tell "just mounted" apart
// from "the action just succeeded".
const initialState: ActionResult = { ok: false, formErrors: {} };

/**
 * The register field set from design/artboards/Spinit DJ Login.dc.html,
 * <!-- RIGHT: FORM -->, isRegister branch. Client-validated with
 * `registerSchema` for immediate feedback, then submitted to the real server
 * action via `useActionState` (design 4.1, design 4.1's form-conversion
 * note). A successful submit renders a "check your email" state instead of
 * the fields, per design 4.1 step 7.
 */
export function RegisterForm({ onSwitchToLogin, action, invitePath }: RegisterFormProps) {
  const isPartner = !!invitePath;
  const activeFieldOrder = isPartner
    ? (['name', 'email', 'confirmEmail', 'password', 'confirmPassword'] as (keyof RegisterValues)[])
    : fieldOrder;
  const [values, setValues] = useState<RegisterValues>(emptyValues);
  const [clientErrors, setClientErrors] = useState<RegisterErrors>({});
  const [state, formAction, pending] = useActionState(action, initialState);

  const serverFieldErrors = !state.ok && 'formErrors' in state ? state.formErrors : {};
  const errors: RegisterErrors = { ...serverFieldErrors, ...clientErrors };
  const generalMessage = !state.ok && 'message' in state ? state.message : undefined;

  function handleChange(name: keyof RegisterValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  /**
   * Passed straight to `<form action>`. Runs the client-side pre-check first
   * — invalid input never reaches the server action at all — and only calls
   * `formAction` (which invokes the real server action) once `registerSchema`
   * is satisfied.
   */
  function submitAction(formData: FormData) {
    const schema = isPartner ? partnerRegisterSchema : registerSchema;
    const result = schema.safeParse(values);
    const nextErrors: RegisterErrors = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const name = issue.path[0] as keyof RegisterValues | undefined;
        if (name && !nextErrors[name]) {
          nextErrors[name] = issue.message;
        }
      }
    }
    setClientErrors(nextErrors);

    const firstInvalid = activeFieldOrder.find((name) => nextErrors[name]);
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    formAction(formData);
  }

  if (state.ok) {
    return (
      <>
        <h2 className={styles.heading}>Check your email</h2>
        <p className={styles.subheading}>
          We sent a confirmation link to {values.email || 'your email address'}. Open it in this
          browser to finish creating your account.
        </p>
        <p className={styles.footPrompt}>
          Already confirmed?{' '}
          <button type="button" className={styles.inlineSwitch} onClick={onSwitchToLogin}>
            Log in
          </button>
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className={styles.heading}>{isPartner ? 'Create your account' : 'Set up your account'}</h2>
      <p className={styles.subheading}>
        {isPartner
          ? 'Then claim your invitation and start building your list.'
          : "Takes about two minutes. You'll connect your first couple's streaming profile next."}
      </p>

      {generalMessage && (
        <p className={styles.notice} role="alert">
          {generalMessage}
        </p>
      )}

      <form action={submitAction} noValidate>
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
          {!isPartner && (
            <Field
              label="DJ business name"
              name="businessName"
              type="text"
              placeholder="Ellis Sound Co."
              value={values.businessName}
              onChange={(e) => handleChange('businessName', e.target.value)}
              error={errors.businessName}
            />
          )}
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
          {!isPartner && (
            <div className={styles.phoneField}>
              <span className={styles.phoneLabel} id="phone-label">
                Phone number
              </span>
              <div className={styles.phoneRow}>
                <select
                  className={styles.dialCode}
                  aria-label="Dial code"
                  name="dialCode"
                  defaultValue={dialCodes[0].value}
                >
                  {dialCodes.map(({ value, label }, index) => (
                    <option key={`${value}-${index}`} value={value}>
                      {label}
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
          )}
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

        {isPartner && (
          <>
            <input type="hidden" name="mode" value="partner" />
            <input type="hidden" name="invitePath" value={invitePath ?? ''} />
          </>
        )}

        <button type="submit" className={styles.submit} disabled={pending}>
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
