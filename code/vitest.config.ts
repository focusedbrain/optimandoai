/**
 * Root Vitest config for workspace tests.
 * Resolves @repo/ingestion-core for electron-vite-project and other packages.
 */
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@repo/ingestion-core': path.resolve(__dirname, 'packages/ingestion-core/src/index.ts'),
    },
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
