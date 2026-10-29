import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // JSX components are referenced as <Icon />, which core no-unused-vars cannot see.
      'no-unused-vars': ['error', { argsIgnorePattern: '^(_|[A-Z])', varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/**/*.test.{js,jsx}', 'src/test/**', 'e2e/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.vitest } },
  },
];
