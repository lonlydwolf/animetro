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
    files: ['tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
  },
];
