/**
 * Root Vitest config for workspace tests.
 * Resolves @repo/ingestion-core for electron-vite-project and other packages.
 *
 * B-8.4d-iii-5a changes:
 *   - `electron` alias → test/mocks/electron.ts unblocks ~25 suites that
 *     fail at collection time with "app.getPath is not a function".
 *   - `globals: true` unblocks ~7 extension-chromium automation / NLP suites
 *     that use describe/beforeEach without imports.
 *   - `exclude` patterns drop Playwright e2e specs from the Vitest run (they
 *     require the Playwright runner, not Vitest).
 *   - `@jest/globals` alias → vitest handles the 2 llm test files.
 */
import { defineConfig } from 'vitest/config'
import path from 'node:path'

const repoRoot = __dirname

export default defineConfig({
  resolve: {
    alias: [
      // Global Electron mock: unblocks suites that import production modules
      // which call app.getPath() at module-load time.  Per-test vi.mock() calls
      // still take precedence over this alias.
      { find: 'electron', replacement: path.resolve(repoRoot, 'test/mocks/electron.ts') },
      // Jest → Vitest shim for the 2 llm tests still importing @jest/globals.
      { find: '@jest/globals', replacement: path.resolve(repoRoot, 'node_modules/vitest/dist/index.js') },
      { find: '@repo/ingestion-core', replacement: path.resolve(repoRoot, 'packages/ingestion-core/src/index.ts') },
      { find: '@repo/pod-client', replacement: path.resolve(repoRoot, 'packages/pod-client/src/index.ts') },
      {
        find: '@ext/handshake/handshakeRpc',
        replacement: path.resolve(repoRoot, 'apps/electron-vite-project/src/shims/handshakeRpc.ts'),
      },
      { find: /^@ext\/(.+)$/, replacement: path.resolve(repoRoot, 'apps/extension-chromium/src/$1') },
      { find: /^@shared\/(.+)$/, replacement: path.resolve(repoRoot, 'packages/shared/src/$1') },
    ],
  },
  test: {
    // Global setup: CSS.escape polyfill + JSDOM viewport defaults.
    // B-8.4d-iii-5b: fixes TypeError in fieldScanner / datavault tests.
    setupFiles: [path.resolve(repoRoot, 'test/setup.ts')],
    // Enable Vitest globals (describe, it, expect, beforeEach, …) without
    // explicit imports.  Required for extension-chromium automation / NLP
    // tests that use globals implicitly.  Tests that already import from
    // 'vitest' continue to work — explicit imports take precedence.
    globals: true,
    // Exclude Playwright e2e specs from the Vitest runner.  These files
    // import @playwright/test and must be executed via `pnpm exec playwright`.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      'apps/extension-chromium/src/vault/autofill/__tests__/e2e-*.spec.ts',
    ],
    server: {
      deps: {
        external: ['ws', 'better-sqlite3'],
      },
    },
  },
  ssr: {
    external: ['ws', 'better-sqlite3'],
  },
  deps: {
    optimizer: {
      ssr: {
        exclude: ['ws', 'better-sqlite3'],
      },
    },
  },
})
