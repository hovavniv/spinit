import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { config as loadDotenv } from 'dotenv';

// Vitest 4.1.11 only exposes `VITE_`-prefixed vars via `import.meta.env`,
// never `process.env` (verified against this repo's installed version) —
// without this, `process.env.NEXT_PUBLIC_SUPABASE_URL` and the
// `TEST_USER_*` vars used by src/lib/auth/rls.integration.test.ts would be
// `undefined` even with a correct `.env.local`, and that suite would skip
// silently instead of running. Loaded here rather than in the test file so
// every test file sees the same `process.env`.
loadDotenv({ path: '.env.local' });

// React Testing Library leaves the rendered tree in the document between tests
// unless it is torn down. Without this, a query in one test can match an element
// that a previous test rendered.
afterEach(() => {
  cleanup();
});
