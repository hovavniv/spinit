import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React Testing Library leaves the rendered tree in the document between tests
// unless it is torn down. Without this, a query in one test can match an element
// that a previous test rendered.
afterEach(() => {
  cleanup();
});
