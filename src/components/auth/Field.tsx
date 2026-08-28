import type { InputHTMLAttributes } from 'react';
import styles from './Field.module.css';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
}

/**
 * One labelled input plus its error message. `aria-invalid` and
 * `aria-describedby` are wired to the error's id so a screen reader reads
 * the error together with the field, not as a disconnected paragraph.
 */
export function Field({ label, name, error, id, className, ...inputProps }: FieldProps) {
  const inputId = id ?? name;
  const errorId = `${inputId}-error`;

  // The error message sits as a sibling of the <label>, not nested inside
  // it: if it were inside, the label's own text content — and so the
  // input's computed accessible name — would grow to include the error
  // text ("Confirm password Passwords do not match."). aria-describedby
  // is the correct wiring for "read the error together with the field"
  // without corrupting the field's name.
  return (
    <div className={styles.field}>
      <label className={styles.labelRow} htmlFor={inputId}>
        <span className={styles.label}>{label}</span>
        <input
          id={inputId}
          name={name}
          className={`${styles.input} ${error ? styles.inputInvalid : ''} ${className ?? ''}`}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          {...inputProps}
        />
      </label>
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
