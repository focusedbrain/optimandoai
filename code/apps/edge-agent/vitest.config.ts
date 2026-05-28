import path from 'node:path'
import { defineConfig } from 'vitest/config'

const repoRoot = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  resolve: {
    alias: {
      '@repo/agent-log-events': path.resolve(repoRoot, 'packages/agent-log-events/src/index.ts'),
    },
  },
  test: {    environment: 'node',
    env: {
      WRDESK_AGENT_PAIRING_HTTP: '1',
    },
  },
})
