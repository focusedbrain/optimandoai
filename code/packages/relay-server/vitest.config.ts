import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@repo/ingestion-core': resolve(__dirname, '../ingestion-core/src/index.ts'),
    },
  },
})
