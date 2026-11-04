import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // `_test-kernels/**` = 多版本 brepkit 的第三方 wasm 包（`scripts/fetch-test-kernels.mjs`
    // 用 npm pack 解出来的，gitignore 掉），不是本仓源码——扫进去只会报上游的 d.ts 噪声。
    ignores: [
      'dist/**',
      'node_modules/**',
      'scripts/**',
      'docs/**',
      'demo/**',
      'packages/demo/**',
      'packages/core/src/brepkit-kernel/_test-kernels/**',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
