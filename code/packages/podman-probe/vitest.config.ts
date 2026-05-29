import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@repo/podman-probe': new URL('./src/index.ts', import.meta.url).pathname,
    },
  },
})
