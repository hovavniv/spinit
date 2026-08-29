import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` has no real npm package installed — Next aliases it
      // internally to this same compiled empty module at build time
      // (node_modules/next/dist/build/create-compiler-aliases.js) and does
      // the identical thing for Jest users
      // (node_modules/next/dist/build/jest/jest.js). Without this, any test
      // that imports a module carrying `import 'server-only'` fails at
      // Vite's module-resolution stage before any vi.mock('server-only', ...)
      // in the test file gets a chance to intercept it.
      'server-only': fileURLToPath(
        new URL('./node_modules/next/dist/compiled/server-only/empty.js', import.meta.url),
      ),
    },
  },
});
