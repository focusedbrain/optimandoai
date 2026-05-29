/**
 * Vitest config for local-pod unit tests (electron mocked, no global test/setup).
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
      {
        find: '@repo/podman-probe',
        replacement: path.resolve(repoRoot, 'packages/podman-probe/src/index.ts'),
      },
    ],
  },
  test: {
    setupFiles: [],
    globals: true,
    include: ['electron/main/local-pod/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
})
