import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      '.wrangler/**',
      'node_modules/**',
      'worker-configuration.d.ts',
      'dashboard/**',
      '.github/actions/report/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', '.github/scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  eslintConfigPrettier,
);
