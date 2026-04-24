/**
 * Root Vitest config for workspace tests.
 * Resolves @repo/ingestion-core for electron-vite-project and other packages.
 */
import { defineConfig } from 'vitest/config'
import path from 'node:path'

const repoRoot = __dirname

export default defineConfig({
  resolve: {
    alias: [
      { find: '@repo/ingestion-core', replacement: path.resolve(repoRoot, 'packages/ingestion-core/src/index.ts') },
      {
        find: '@ext/handshake/handshakeRpc',
        replacement: path.resolve(repoRoot, 'apps/electron-vite-project/src/shims/handshakeRpc.ts'),
      },
      { find: /^@ext\/(.+)$/, replacement: path.resolve(repoRoot, 'apps/extension-chromium/src/$1') },
      { find: /^@shared\/(.+)$/, replacement: path.resolve(repoRoot, 'packages/shared/src/$1') },
    ],
  },
  test: {
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
