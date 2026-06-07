#!/usr/bin/env node
/**
 * Full orchestrator build for two-box sessions (Windows host or manual re-build).
 *
 * Usage: pnpm session:build
 */
const { formatBuildLine, runOrchestratorBuild } = require('./session/build.cjs')

function main() {
  const { provenance, launchPath } = runOrchestratorBuild()
  console.log(formatBuildLine(provenance))
  console.log(`launch: ${launchPath}`)
  console.log('restart WR Desk from the launch path above before Step 3.')
}

try {
  main()
} catch (err) {
  console.error(err.message?.includes('\n') ? err.message : `session:build failed: ${err.message}`)
  process.exit(1)
}
