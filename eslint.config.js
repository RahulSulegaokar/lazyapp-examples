import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'data/**', 'deploy/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: true }],
      '@typescript-eslint/require-await': 'off',
      // Generic accessors like `kv.get<T>()` are a deliberate caller-side assertion.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      // Base-class getters overridden by subclasses (e.g. `retryable`) are clearer than fields.
      '@typescript-eslint/class-literal-property-style': 'off',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/test/**/*.ts', 'vitest.config.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked },
  prettier,
);
