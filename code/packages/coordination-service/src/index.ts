/**
 * Coordination Service — Entry point
 * Multi-tenant relay for BEAP capsules on wrdesk.com
 */

import { loadConfig } from './config.js'
import { initStore, closeStore } from './store.js'
import { createServer } from './server.js'
import { startCleanupInterval } from './cleanup.js'

async function main(): Promise<void> {
  const config = loadConfig()
  if (!config.oidc_audience?.trim()) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Coordination] FATAL: COORD_OIDC_AUDIENCE is not set. Refusing to start.')
      process.exit(1)
    }
    console.warn('[Coordination] COORD_OIDC_AUDIENCE not set — audience check skipped. Consider setting for production.')
  }
  initStore(config)
  const server = createServer(config)
  startCleanupInterval()

  server.listen(config.port, config.host, () => {
    const proto = config.tls_cert_path ? 'https' : 'http'
    console.log(`[Coordination] ${proto} server listening on ${config.host}:${config.port}`)
  })

  server.on('error', (err: Error) => {
    console.error('[Coordination] Server error:', err.message)
    closeStore()
    process.exit(1)
  })

  const shutdown = () => {
    server.close(() => {
      closeStore()
      process.exit(0)
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('[Coordination] Startup error:', err)
  process.exit(1)
})
