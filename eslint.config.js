import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Module boundaries, kept from the Angular workspace (which enforced them with Nx tags): a package may only use the packages
 * below it, and an app may not reach into another app.
 *   core -> (nothing)   data-access -> core   ui -> core   state -> core, data-access   apps -> all packages
 */
const forbid = (names, why) => ({ patterns: [{ group: names.map((n) => `@shop/${n}`), message: why }] });

export default tseslint.config(
  { ignores: ['**/dist', '**/coverage', '**/node_modules', '**/public/**/*.js', 'testdata'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The DI shims use empty-bodied classes and `this`-less decorators on purpose.
      '@typescript-eslint/no-extraneous-class': 'off',
      // Several stores are class-based with decorators and constructor side effects, as in the Angular code they came from.
      'no-empty-function': 'off',
      // Not every effect lists every dependency on purpose (e.g. "load once per id"); those lines say why.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  { files: ['packages/core/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', forbid(['data-access', 'state', 'ui'], 'core is the bottom layer and depends on nothing else.')] } },
  { files: ['packages/data-access/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', forbid(['state', 'ui'], 'data-access may only use core.')] } },
  { files: ['packages/ui/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', forbid(['data-access', 'state'], 'ui components get data through props or core hooks, never from the API layer.')] } },
  { files: ['packages/state/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', forbid(['ui'], 'state does not render anything.')] } },
  { files: ['apps/storefront/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@shop/admin', '@shop/seller', '**/apps/admin/**', '**/apps/seller/**'], message: 'Apps do not depend on each other.' }] }] } },
  { files: ['apps/admin/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@shop/storefront', '@shop/seller', '**/apps/storefront/**', '**/apps/seller/**'], message: 'Apps do not depend on each other.' }] }] } },
  { files: ['apps/seller/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@shop/storefront', '@shop/admin', '**/apps/storefront/**', '**/apps/admin/**'], message: 'Apps do not depend on each other.' }] }] } },
  { files: ['**/*.spec.{ts,tsx}', '**/test-*.{ts,tsx}'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
);
