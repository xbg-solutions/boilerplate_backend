const tseslint = require('typescript-eslint');

/**
 * Flat config (eslint 9+). The previous `lint` script delegated to
 * `--workspaces --if-present`, no workspace defined a `lint` script, and eslint
 * was not installed at all — so `npm run lint` exited 0 having linted nothing.
 * This config is deliberately rooted here and run directly, so it cannot become
 * a no-op again.
 *
 * Non-type-checked rules only: type-aware linting would need a project
 * reference per workspace across 25 packages for little added signal here.
 */
module.exports = tseslint.config(
  {
    ignores: [
      '**/lib/**',
      '**/node_modules/**',
      '**/coverage/**',
      'functions/**',
      // Committed output of the code generator. Its style is decided by the
      // generator, not by hand — lint the generator, not what it emits.
      'packages/*/test-output/**',
      'packages/*/src/project-template/**',
      'packages/create-backend/src/project-template/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // Surfaced across the connector packages, where `any` is used at genuine
      // SDK boundaries. Worth revisiting, but not by weakening types under time
      // pressure — left as a warning so it is visible without blocking.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Node tooling and config files are CommonJS by design.
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', process: 'readonly', console: 'readonly', __dirname: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/*/src/**/__tests__/**/*.ts'],
    languageOptions: { globals: { jest: 'readonly' } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
