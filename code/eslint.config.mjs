// eslint.config.mjs (Flat Config für ESLint v9)
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  // Solide TypeScript-Regeln (ohne type-checking; schnell & stabil)
  ...tseslint.configs.recommended,

  // Globales Ignorieren von Build-/Dependency-Verzeichnissen
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/coverage/**'
    ],
  },

  // Prettier zuletzt, um Konflikte zu neutralisieren
  prettier,
];
