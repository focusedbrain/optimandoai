/**
 * Isolated Vitest config for pod/vault decoupling regressions.
 * Does NOT load test/setup.ts (no global mock pod, no hostPodReady override).
 *
 * Run from repo root:
 *   pnpm exec vitest run --config apps/electron-vite-project/vitest.podVault.config.ts
 */
import { defineConfig } from 'vitest/config'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../..')
const appRoot = __dirname

export default defineConfig({
  root: appRoot,
  resolve: {
    alias: [
      {
        find: 'electron',
        replacement: path.resolve(repoRoot, 'test/mocks/electron.ts'),
      },
      { find: '@jest/globals', replacement: path.resolve(repoRoot, 'node_modules/vitest/dist/index.js') },
      { find: '@repo/agent-log-events', replacement: path.resolve(repoRoot, 'packages/agent-log-events/src/index.ts') },
      { find: '@repo/ingestion-core', replacement: path.resolve(repoRoot, 'packages/ingestion-core/src/index.ts') },
      { find: '@repo/email-fetch', replacement: path.resolve(repoRoot, 'packages/email-fetch/src/index.ts') },
      { find: '@repo/pod-client', replacement: path.resolve(repoRoot, 'packages/pod-client/src/index.ts') },
      { find: '@repo/beap-cert', replacement: path.resolve(repoRoot, 'packages/beap-cert/src/index.ts') },
    ],
  },
  test: {
    setupFiles: [],
    globals: true,
    include: ['electron/main/local-pod/__tests__/podVaultDecoupling.test.ts'],
    exclude: ['**/node_modules/**'],
  },
})
