'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandPanel } from './BrandPanel';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import styles from './AuthScreen.module.css';

type Mode = 'login' | 'register';

interface AuthScreenProps {
  defaultMode: Mode;
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
export function AuthScreen({ defaultMode }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const router = useRouter();

  function switchMode(next: Mode) {
    setMode(next);
    router.replace(next === 'login' ? '/login' : '/register');
  }

  return (
    <div className={styles.screen}>
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
            <LoginForm onSwitchToRegister={() => switchMode('register')} />
          ) : (
            <RegisterForm onSwitchToLogin={() => switchMode('login')} />
          )}
        </div>
      </div>
    </div>
  );
}
