import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

// eslint-config-next 16 ships flat configs directly, so there is no FlatCompat
// wrapper here. Wrapping them in one throws a circular-structure error, because
// the old wrapper tries to JSON-serialise a config that now contains plugin objects.
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  // Turns off the ESLint rules that only concern formatting, so Prettier owns
  // layout and the two tools never disagree about the same line. Must stay last.
  prettier,
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'design/**'],
  },
];

export default eslintConfig;
