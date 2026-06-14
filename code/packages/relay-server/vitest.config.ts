import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    // P2 sandbox-egress: small context_sync cap/rate so the ingress cap + throttle
    // tests are cheap and deterministic. Only the sandbox-egress tests read these.
    env: {
      WRDESK_SANDBOX_CONTEXT_SYNC_MAX_BYTES: '4096',
      WRDESK_SANDBOX_CONTEXT_SYNC_MAX_PER_WINDOW: '4',
      WRDESK_SANDBOX_CONTEXT_SYNC_RATE_WINDOW_MS: '60000',
    },
  },
  resolve: {
    alias: {
      '@repo/ingestion-core': resolve(__dirname, '../ingestion-core/src/index.ts'),
    },
  },
})
