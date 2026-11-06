// Lint config (ESLint flat config). The app has no runtime dependencies; ESLint is only for development.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['build/', 'node_modules/'] },
  js.configs.recommended,
  // Empty catches are deliberate: storage and audio can be refused (private windows, blocked cookies) and the app carries on.
  { rules: { 'no-empty': ['error', { allowEmptyCatch: true }] } },
  {
    files: ['web/js/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
  },
  {
    // tests run in Node but stand in for the browser (tests/setup.mjs), so both sets of globals apply
    files: ['tests/**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
];
