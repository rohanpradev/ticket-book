import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: { outDir: 'dist' },
  fmt: {
    singleQuote: true,
    printWidth: 100,
    ignorePatterns: ['dist/**', 'node_modules/**', '.openai/**', 'bun.lock', 'docs/benchmarks/**'],
  },
  lint: {
    plugins: ['typescript', 'react', 'jsx-a11y', 'import', 'unicorn', 'oxc'],
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ['dist/**', 'node_modules/**', '.openai/**'],
    categories: { correctness: 'error' },
    overrides: [
      {
        files: ['src/web/**/*.{ts,tsx}'],
        rules: {
          'import/no-nodejs-modules': 'error',
          'no-restricted-imports': ['error', { patterns: ['**/server/**'] }],
        },
      },
      {
        files: ['src/shared/**/*.{ts,tsx}'],
        rules: {
          'import/no-nodejs-modules': 'error',
          'no-restricted-imports': ['error', { patterns: ['**/server/**', '**/web/**'] }],
        },
      },
      {
        files: ['src/server/**/*.{ts,tsx}'],
        rules: {
          'no-restricted-imports': ['error', { patterns: ['**/web/**'] }],
        },
      },
      {
        files: [
          'src/server/routes/**/*.ts',
          'src/server/service.ts',
          'src/server/queue.ts',
          'src/server/worker.ts',
        ],
        rules: {
          'no-restricted-properties': [
            'error',
            {
              object: 'sql',
              property: 'unsafe',
              message:
                'Use parameterized SQL. Unsafe SQL is reserved for trusted migrations and constant setup.',
            },
            {
              object: 'tx',
              property: 'unsafe',
              message: 'Use parameterized SQL. Unsafe SQL is reserved for trusted migrations.',
            },
          ],
        },
      },
    ],
    rules: {
      'typescript/no-explicit-any': 'error',
      'typescript/no-non-null-assertion': 'error',
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'typescript/no-floating-promises': ['error', { ignoreVoid: true }],
      'react/rules-of-hooks': 'error',
      'react/exhaustive-deps': 'error',
      'import/no-cycle': 'error',
    },
  },
});
