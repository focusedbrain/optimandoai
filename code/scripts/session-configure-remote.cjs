#!/usr/bin/env node
/**
 * Point this machine's orchestrator at the LAN relay (Windows host or second run).
 *
 * Usage: pnpm session:configure-remote <RELAY_IP>
 */
const { configureCoordinationOnMachine } = require('./session/lib.cjs')

function main() {
  const relayIp = (process.argv[2] || '').trim()
  if (!relayIp) {
    console.error('usage: pnpm session:configure-remote <RELAY_IP>')
    process.exit(2)
  }
  const urls = configureCoordinationOnMachine(relayIp)
  console.log(`coordination_url=${urls.coordination_url}`)
  console.log(`coordination_ws_url=${urls.coordination_ws_url}`)
}

try {
  main()
} catch (err) {
  console.error(`session:configure-remote failed: ${err.message}`)
  process.exit(1)
}
