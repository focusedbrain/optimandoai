/**
 * Vitest config for mode resolver tests — no global mock pod server.
 */
import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: [
      { find: 'electron', replacement: path.resolve(repoRoot, 'test/mocks/electron.ts') },
      { find: '@repo/ingestion-core', replacement: path.resolve(repoRoot, 'packages/ingestion-core/src/index.ts') },
      { find: '@repo/pod-client', replacement: path.resolve(repoRoot, 'packages/pod-client/src/index.ts') },
      {
        find: '@beap-pod/depackagePipeline',
        replacement: path.resolve(repoRoot, 'packages/beap-pod/src/roles/depackagePipeline.ts'),
      },
    ],
  },
  test: {
    name: 'modeResolver',
    include: [
      'apps/electron-vite-project/electron/main/ingestion/__tests__/modeResolver/**/*.test.ts',
    ],
    setupFiles: [],
    globals: true,
  },
})
