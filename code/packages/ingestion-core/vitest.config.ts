import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      // Use dist so tests run against built output; ensures consistency with consumers
      '@repo/ingestion-core': resolve(__dirname, './dist/index.js'),
    },
  },
});
