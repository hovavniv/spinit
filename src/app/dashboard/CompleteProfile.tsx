'use client';

import { useActionState, useState } from 'react';
import { profileSchema } from '@/lib/validation';
import type { ActionResult } from '@/lib/auth/errors';

interface CompleteProfileProps {
  /**
   * `updateProfile` from `lib/auth/actions`, passed down from
   * `app/dashboard/page.tsx`. This component never imports
   * `lib/auth/actions` itself — that module pulls in `next/headers` and
   * `dal.ts`'s `import 'server-only'`, neither importable from jsdom
   * (design 6, design 10.3) — so the action is always received as a prop,
   * which is also what keeps this component testable with a plain
   * `vi.fn()`, matching `LoginForm`/`RegisterForm` (task 9).
   */
  updateProfile: (prevState: ActionResult, formData: FormData) => Promise<ActionResult>;
}

interface ProfileValues {
  businessName: string;
  phone: string;
}

type ProfileErrors = Partial<Record<keyof ProfileValues, string>>;

const fieldOrder: (keyof ProfileValues)[] = ['businessName', 'phone'];

// Never `{ ok: true }` — that value is reserved for a real successful
// submit, so a render can tell "just mounted" apart from "the action just
// succeeded" (same reasoning as LoginForm/RegisterForm, task 9).
const initialState: ActionResult = { ok: false, formErrors: {} };

/**
 * The "finish your profile" form shown to a Google user, whose profile row
 * arrives with `business_name`/`phone` null because Google's OAuth profile
 * carries neither (design 1, design 4.6). Client-validated with
 * `profileSchema` for immediate feedback, then submitted to the real
 * `updateProfile` server action via `useActionState`, mirroring the
 * `LoginForm`/`RegisterForm` conversion from task 9.
 */
export function CompleteProfile({ updateProfile }: CompleteProfileProps) {
  const [values, setValues] = useState<ProfileValues>({ businessName: '', phone: '' });
  const [clientErrors, setClientErrors] = useState<ProfileErrors>({});
  const [state, formAction, pending] = useActionState(updateProfile, initialState);

  const serverFieldErrors = !state.ok && 'formErrors' in state ? state.formErrors : {};
  const errors: ProfileErrors = { ...serverFieldErrors, ...clientErrors };
  const generalMessage = !state.ok && 'message' in state ? state.message : undefined;

  function handleChange(name: keyof ProfileValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  /**
   * Passed straight to `<form action>`. Runs the client-side pre-check
   * first — invalid input never reaches the server action at all — and only
   * calls `formAction` once `profileSchema` is satisfied.
   */
  function submitAction(formData: FormData) {
    const result = profileSchema.safeParse(values);
    const nextErrors: ProfileErrors = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const name = issue.path[0] as keyof ProfileValues | undefined;
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
    <section>
      <h2>Finish your profile</h2>
      <p>Add your DJ business name and phone number so the app can reach you about events.</p>

      {generalMessage && <p role="alert">{generalMessage}</p>}

      <form action={submitAction} noValidate>
        <div>
          <label htmlFor="businessName">
            Business name
            <input
              id="businessName"
              name="businessName"
              type="text"
              value={values.businessName}
              onChange={(e) => handleChange('businessName', e.target.value)}
              aria-invalid={!!errors.businessName}
              aria-describedby={errors.businessName ? 'businessName-error' : undefined}
            />
          </label>
          {errors.businessName && (
            <span id="businessName-error" role="alert">
              {errors.businessName}
            </span>
          )}
        </div>

        <div>
          <label htmlFor="phone">
            Phone number
            <input
              id="phone"
              name="phone"
              type="tel"
              value={values.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? 'phone-error' : undefined}
            />
          </label>
          {errors.phone && (
            <span id="phone-error" role="alert">
              {errors.phone}
            </span>
          )}
        </div>

        <button type="submit" disabled={pending}>
          Save profile
        </button>
      </form>
    </section>
  );
}
