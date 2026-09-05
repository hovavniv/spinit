'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { JoinActionResult } from '@/lib/live/guestActions';
import styles from './JoinForm.module.css';

/**
 * The name screen's form (design §7.3). Takes `joinAction` as a prop rather
 * than importing the real server action, mirroring `PreFlight.tsx`'s own
 * convention. Calls it directly (not via `<form action>`) and does the
 * navigation itself on success with `useRouter` -- this sidesteps the
 * Server-Component-form-action gotcha entirely (CLAUDE.md), since this
 * component only ever needs to run on the client.
 */
export function JoinForm({
  token,
  joinAction,
}: {
  token: string;
  joinAction: (token: string, displayName: string) => Promise<JoinActionResult>;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await joinAction(token, name);
    if (result.ok) {
      router.push(`/join/${token}/songs`);
      return;
    }
    setSubmitting(false);
    setError(result.message);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.label} htmlFor="guest-name">
        What should we call you?
      </label>
      <input
        id="guest-name"
        className={styles.input}
        type="text"
        value={name}
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        placeholder="Table 7"
        disabled={submitting}
      />
      {error && <p className={styles.error}>{error}</p>}

      <button type="submit" className={styles.button} disabled={submitting || name.trim().length === 0}>
        {submitting ? 'Joining…' : 'Join the floor'}
      </button>

      <p className={styles.hint}>Shown to the DJ and on the couple&rsquo;s playlist</p>
    </form>
  );
}
