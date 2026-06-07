#!/usr/bin/env node
/**
 * Two-box session bootstrap (mini-PC / relay host).
 *
 * Full orchestrator build → kill stale instances → relay → local p2p_config patch.
 * Prints build provenance, Windows host commands, and the Step-3 launch command.
 *
 * Usage: pnpm session:start
 */
const { formatBuildLine, runOrchestratorBuild } = require('./session/build.cjs')
const {
  detectLanIPv4,
  configureCoordinationOnMachine,
  startRelay,
  waitForHealth,
  windowsHostLine,
} = require('./session/lib.cjs')

async function main() {
  const { provenance, launchPath } = runOrchestratorBuild()
  const relayIp = detectLanIPv4()
  startRelay()
  await waitForHealth('127.0.0.1', 51249)
  configureCoordinationOnMachine(relayIp)

  console.log(formatBuildLine(provenance))
  console.log(`windows: ${windowsHostLine(relayIp)}`)
  console.log(`launch: ${launchPath}`)
  console.log('ready — begin runbook at step 2')
}

main().catch((err) => {
  console.error(`session:start failed: ${err.message}`)
  process.exit(1)
})
