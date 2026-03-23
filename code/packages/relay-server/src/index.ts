/**
 * Relay server entry point.
 * Standalone HTTP/HTTPS server for BEAP capsule relay.
 */

import { loadRelayConfig } from './config.js'
import { initStore } from './store.js'
import { createServer, startCleanupInterval } from './server.js'

async function main(): Promise<void> {
  const config = await loadRelayConfig()
  if (!config.relay_auth_secret?.trim()) {
    console.error('[Relay] RELAY_AUTH_SECRET is required. Set env or relay-config.json.')
    process.exit(1)
  }
  initStore(config)
  const server = createServer(config)
  startCleanupInterval(config)
  server.listen(config.port, config.bind_address, () => {
    const proto = config.tls_enabled ? 'https' : 'http'
    console.log(`[Relay] ${proto} server listening on ${config.bind_address}:${config.port}`)
  })
  server.on('error', (err) => {
    console.error('[Relay] Server error:', err.message)
    process.exit(1)
  })
}

main().catch((err) => {
  console.error('[Relay] Startup error:', err)
  process.exit(1)
})
