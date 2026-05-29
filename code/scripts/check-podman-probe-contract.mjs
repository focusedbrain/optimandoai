#!/usr/bin/env node
/**
 * Cross-surface Podman probe contract — CI gate.
 * Ensures shell/TS gates implement the same mandatory steps (drift = bypass risk).
 *
 * Usage: node scripts/check-podman-probe-contract.mjs
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

/** Must match @repo/podman-probe buildRemoteLinuxPodmanPreflightShell('podman') */
const REMOTE_LINUX_PREFLIGHT_PREFIX = 'command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1'

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function main() {
  const violations = []

  const relayShell = read('packages/coordination-service/scripts/beap-isolation-preflight.sh')
  const relayDeploy = read('packages/coordination-service/deploy-bundle/deploy-relay-host.sh')
  const preflightGate = read('apps/electron-vite-project/electron/main/security/beapPreflightGate.ts')
  const podStatus = read('apps/electron-vite-project/electron/main/local-pod/podStatus.ts')
  const deployTs = read('apps/electron-vite-project/electron/main/edge-tier/ssh/deploy.ts')
  const contractTs = read('packages/podman-probe/src/contract.ts')

  if (!relayShell.includes('command -v')) {
    violations.push('beap-isolation-preflight.sh: missing binary_on_path check')
  }
  if (!relayShell.includes('info >/dev/null')) {
    violations.push('beap-isolation-preflight.sh: missing engine_healthy (podman info) check')
  }
  if (relayShell.includes('COORD_BEAP_ISOLATION_SKIP=1') && relayShell.includes('exit 0')) {
    const skipBlock = relayShell.split('COORD_BEAP_ISOLATION_SKIP')[1]?.split('fi')[0] ?? ''
    if (skipBlock.includes('exit 0')) {
      violations.push('beap-isolation-preflight.sh: COORD_BEAP_ISOLATION_SKIP must not bypass (exit 0)')
    }
  }

  if (!relayDeploy.includes(' info >/dev/null')) {
    violations.push('deploy-relay-host.sh: missing podman info gate')
  }
  if (!relayDeploy.includes('beap-isolation-preflight.sh')) {
    violations.push('deploy-relay-host.sh: must invoke beap-isolation-preflight.sh')
  }

  if (!deployTs.includes('buildRemotePodmanPreflightCommand')) {
    violations.push('edge-tier/ssh/deploy.ts: missing buildRemotePodmanPreflightCommand')
  }
  if (!deployTs.includes('verify_podman')) {
    violations.push('edge-tier/ssh/deploy.ts: missing verify_podman deploy stage')
  }
  if (!deployTs.includes('buildRemoteLinuxPodmanPreflightShell')) {
    violations.push('edge-tier/ssh/deploy.ts: must use buildRemoteLinuxPodmanPreflightShell from @repo/podman-probe')
  }
  if (
    !contractTs.includes('command -v ${podmanBin}') ||
    !contractTs.includes('info >/dev/null 2>&1')
  ) {
    violations.push('@repo/podman-probe contract: remote Linux preflight shell drift')
  }

  if (!preflightGate.includes('isPodmanVerifiedReady')) {
    violations.push('beapPreflightGate.ts: must use isPodmanVerifiedReady (probe complete + ready)')
  }
  if (!podStatus.includes('isPodmanVerifiedReady')) {
    violations.push('podStatus.ts: must export isPodmanVerifiedReady')
  }
  if (!podStatus.includes("'pending'")) {
    violations.push('podStatus.ts: initial probe state must be pending (no false-ready before probe)')
  }

  if (!contractTs.includes('binary_on_path')) {
    violations.push('packages/podman-probe/src/contract.ts: missing contract steps')
  }

  if (violations.length > 0) {
    console.error('[podman-probe-contract] FATAL — cross-surface drift detected:')
    for (const v of violations) {
      console.error(`  - ${v}`)
    }
    process.exit(1)
  }

  console.log('[podman-probe-contract] OK — orchestrator, edge, relay gates aligned with contract')
  process.exit(0)
}

main()
