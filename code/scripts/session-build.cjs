#!/usr/bin/env node
/**
 * Full orchestrator build for two-box sessions (Windows host or manual re-build).
 *
 * On Windows host-as-relay: kills WR Desk + relay (electron.exe) during build,
 * then ensures the coordination relay is listening again before exit.
 *
 * Usage: pnpm session:build
 */
const { formatBuildLine, runOrchestratorBuild } = require('./session/build.cjs')
const { ensureRelayUp } = require('./session/lib.cjs')

async function main() {
  const { provenance, launchPath } = runOrchestratorBuild()
  if (process.platform === 'win32') {
    await ensureRelayUp('127.0.0.1', 51249)
  }
  console.log(formatBuildLine(provenance))
  console.log(`launch: ${launchPath}`)
  console.log('restart WR Desk from the launch path above before Step 3.')
}

main().catch((err) => {
  console.error(err.message?.includes('\n') ? err.message : `session:build failed: ${err.message}`)
  process.exit(1)
})
