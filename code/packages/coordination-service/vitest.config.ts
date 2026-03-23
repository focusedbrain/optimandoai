import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@repo/ingestion-core': resolve(__dirname, '../ingestion-core/src/index.ts'),
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
