'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandPanel } from './BrandPanel';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import type { ActionResult } from '@/lib/auth/errors';
import styles from './AuthScreen.module.css';

type Mode = 'login' | 'register';
type FormAction = (prevState: ActionResult, formData: FormData) => Promise<ActionResult>;

interface AuthScreenProps {
  defaultMode: Mode;
  /**
   * `signInWithPassword` / `signUpWithPassword` from `lib/auth/actions`,
   * received from `app/login/page.tsx` / `app/register/page.tsx` and threaded
   * straight down to `LoginForm` / `RegisterForm`. `AuthScreen` never imports
   * `lib/auth/actions` itself — see the note in `LoginForm.tsx` (design 6).
   */
  loginAction: FormAction;
  registerAction: FormAction;
  /**
   * Short, DJ-facing copy derived from `/auth/callback/route.ts`'s failure
   * redirect (`?error=confirmation_failed[_same_browser]`), mapped to fixed
   * strings by `app/login/page.tsx` — never the raw query value. Only ever
   * relevant in login mode; threaded straight to `LoginForm`.
   */
  callbackMessage?: string;
  /**
   * Non-null only when the visitor arrived from an invitation; threaded
   * straight to `RegisterForm`.
   */
  invitePath?: string | null;
}

/**
 * design/artboards/Spinit DJ Login.dc.html — one screen, a Log in / Register
 * pill toggle over a form. The port gives each mode its own URL: /login and
 * /register each render this with their own defaultMode.
 *
 * Four things switch mode, not two: the two pill buttons here, and the two
 * inline foot-links inside LoginForm and RegisterForm. All four call
 * switchMode. The mode swap itself is immediate client state; router.replace
 * only catches the address bar up afterwards, it is not awaited.
 */
export function AuthScreen({
  defaultMode,
  loginAction,
  registerAction,
  callbackMessage,
  invitePath,
}: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const router = useRouter();

  // Parsed back out of invitePath (shape `/invite/{uuid}/{slot}`) rather than
  // threading raw `invite`/`slot` values down as separate props: invitePath
  // is already the one piece of invite state this component receives, so
  // reconstructing the query string from it avoids adding a second prop pair
  // that would need to stay in sync with it.
  const inviteQuery = invitePath ? invitePath.match(/^\/invite\/([^/]+)\/([12])$/) : null;
  const inviteSearch = inviteQuery ? `?invite=${inviteQuery[1]}&slot=${inviteQuery[2]}` : '';

  function switchMode(next: Mode) {
    setMode(next);
    router.replace((next === 'login' ? '/login' : '/register') + inviteSearch);
  }

  return (
    <main className={styles.screen}>
      <BrandPanel />

      <div className={styles.formSide}>
        <div className={styles.formCard}>
          <div className={styles.tabList} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`}
              onClick={() => switchMode('login')}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={`${styles.tab} ${mode === 'register' ? styles.tabActive : ''}`}
              onClick={() => switchMode('register')}
            >
              Register
            </button>
          </div>

          {mode === 'login' ? (
            <LoginForm
              onSwitchToRegister={() => switchMode('register')}
              action={loginAction}
              callbackMessage={callbackMessage}
              invitePath={invitePath}
            />
          ) : (
            <RegisterForm
              onSwitchToLogin={() => switchMode('login')}
              action={registerAction}
              invitePath={invitePath}
            />
          )}
        </div>
      </div>
    </main>
  );
}
