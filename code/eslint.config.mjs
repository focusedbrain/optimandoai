// eslint.config.mjs (Flat Config für ESLint v9)
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  // Solide TypeScript-Regeln (ohne type-checking; schnell & stabil)
  ...tseslint.configs.recommended,

  // Globales Ignorieren von Build-/Dependency-Verzeichnissen
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', '**/coverage/**'],
  },

  // ── Write Boundary: restrict setValueSafely imports ──
  // Only committer.ts (definition), inlinePopover.ts (click-to-fill), and
  // test files may import setValueSafely. All other callers must use
  // commitInsert via writeBoundary.ts or the barrel index.
  {
    files: ['apps/extension-chromium/src/**/*.ts', 'apps/extension-chromium/src/**/*.tsx'],
    ignores: [
      'apps/extension-chromium/src/vault/autofill/committer.ts',
      'apps/extension-chromium/src/vault/autofill/inlinePopover.ts',
      'apps/extension-chromium/src/vault/autofill/writeBoundary.ts',
      'apps/extension-chromium/src/vault/autofill/**/*.test.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: './committer',
            importNames: ['setValueSafely'],
            message: 'setValueSafely is restricted. Use commitInsert() via writeBoundary instead.',
          },
          {
            name: '../committer',
            importNames: ['setValueSafely'],
            message: 'setValueSafely is restricted. Use commitInsert() via writeBoundary instead.',
          },
        ],
        patterns: [
          {
            group: ['**/committer'],
            importNames: ['setValueSafely'],
            message: 'setValueSafely is restricted. Use commitInsert() via writeBoundary instead.',
          },
        ],
      }],
    },
  },

  // Prettier zuletzt, um Konflikte zu neutralisieren
  prettier,
];
