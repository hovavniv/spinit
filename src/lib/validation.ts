import { z } from 'zod';

/**
 * Mirrors the SQL `phone_fmt` check constraint (design 5.1):
 * `phone ~ '^\+?[0-9 ()-]{7,20}$'`. Exported so the server action that joins
 * the dial code and local number together (design 4.1 step 4, plan task 7)
 * can validate that joined string against the exact same shape used here and
 * enforced by the database.
 */
export const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;

/**
 * A `FormData` field is typed `FormDataEntryValue | null` (`string | File |
 * null`), not `string`. Zod's schemas below expect a plain object of
 * strings, so every entry is coerced through here first: a `File` part or a
 * missing field both become `''`, which then fails the schema's own
 * `min(1)`/format checks as an ordinary validation error rather than
 * throwing a `TypeError` out of the caller (design 7.1).
 */
export function formDataToRecord(formData: FormData): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    record[key] = typeof value === 'string' ? value : '';
  }
  return record;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

const emailField = z
  .string()
  .min(1, 'Email is required.')
  .max(254, 'Enter a valid email address.')
  .pipe(z.email('Enter a valid email address.'));

const nameField = z
  .string()
  .min(1, 'Name is required.')
  .max(100, 'Name must be at most 100 characters.');

const businessNameField = z
  .string()
  .min(1, 'DJ business name is required.')
  .max(100, 'DJ business name must be at most 100 characters.');

const phoneField = z
  .string()
  .min(1, 'Phone number is required.')
  .max(20, 'Phone number must be at most 20 characters.')
  .refine((value) => PHONE_PATTERN.test(value), 'Enter a valid phone number.');

const registerPasswordField = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .refine((value) => byteLength(value) <= 72, 'Password must be at most 72 characters.');

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required.'),
});

export const registerSchema = z
  .object({
    name: nameField,
    businessName: businessNameField,
    email: emailField,
    confirmEmail: z.string().min(1, 'Confirm your email.'),
    phone: phoneField,
    password: registerPasswordField,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .superRefine((values, ctx) => {
    if (
      values.email &&
      values.confirmEmail &&
      values.confirmEmail.trim().toLowerCase() !== values.email.trim().toLowerCase()
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmEmail'],
        message: 'Emails do not match.',
      });
    }

    if (values.password && values.confirmPassword && values.confirmPassword !== values.password) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match.',
      });
    }
  });

export const profileSchema = z.object({
  businessName: businessNameField,
  phone: phoneField,
});
