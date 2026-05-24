/**
 * Developer CLI for edge-tier setup — Phase 3 (P3.8).
 *
 * NOT production-grade; enables end-to-end testing before the Phase 4 wizard.
 *
 * Usage:
 *   pnpm exec tsx apps/electron-vite-project/scripts/edge-cli.ts generate-keypair [--derive-key-hex <64hex>]
 *   pnpm exec tsx apps/electron-vite-project/scripts/edge-cli.ts register-edge --host <h> --port <p> [--sso-token <jwt>] [--derive-key-hex <64hex>] [--pod-id <uuid>]
 *   pnpm exec tsx apps/electron-vite-project/scripts/edge-cli.ts deploy-edge --host <h> --user <u> --ssh-key <path> [--port <p>] [--derive-key-hex <64hex>] [--pod-id <uuid>]
 *
 * Env:
 *   WR_DESK_USER_DATA          — settings + encrypted key store directory
 *   BEAP_ATTESTATION_STUB=1    — stub Keycloak attestation (dev/CI)
 *   BEAP_EDGE_DEV_DERIVE_KEY_HEX — default VMK-derived key for encrypting edge private keys
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import process from 'node:process'

import { generateEdgeKeypair } from '../electron/main/edge-tier/keygen.js'
import {
  upsertEdgeReplica,
  loadEdgeTierSettings,
  type EdgeReplica,
} from '../electron/main/edge-tier/settings.js'
import { requestSsoAttestation } from '../electron/main/edge-tier/attestation.js'
import {
  storeEncryptedEdgePrivateKey,
  loadEncryptedEdgePrivateKeyHex,
} from '../electron/main/edge-tier/keyStorage.js'
import {
  applyEdgeTierSettingsAndRestartPod,
} from '../electron/main/edge-tier/podLifecycle.js'

const execFileAsync = promisify(execFile)

function usage(): never {
  console.error(`Usage:
  edge-cli generate-keypair [--derive-key-hex <64hex>]
  edge-cli register-edge --host <host> --port <port> [--sso-token <jwt>] [--derive-key-hex <64hex>] [--pod-id <uuid>]
  edge-cli deploy-edge --host <host> --user <user> --ssh-key <path> [--port <port>] [--derive-key-hex <64hex>] [--pod-id <uuid>]`)
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function makeDevVault(deriveKeyHex: string) {
  const key = Buffer.from(deriveKeyHex, 'hex')
  if (key.length < 32) {
    throw new Error('--derive-key-hex must be at least 32 bytes (64 hex chars)')
  }
  return {
    deriveApplicationKey: () => Buffer.from(key),
  }
}

function resolveDeriveKeyHex(flags: Record<string, string | boolean>): string {
  const fromFlag = flags['derive-key-hex']
  if (typeof fromFlag === 'string' && fromFlag.length > 0) return fromFlag
  const fromEnv = process.env['BEAP_EDGE_DEV_DERIVE_KEY_HEX']
  if (fromEnv) return fromEnv
  throw new Error('Provide --derive-key-hex or set BEAP_EDGE_DEV_DERIVE_KEY_HEX')
}

async function cmdGenerateKeypair(flags: Record<string, string | boolean>): Promise<void> {
  const keypair = generateEdgeKeypair()
  const deriveKeyHex = resolveDeriveKeyHex(flags)
  const vault = makeDevVault(deriveKeyHex)
  storeEncryptedEdgePrivateKey(keypair.podId, keypair.privateKeyHex, vault)

  const bundle = {
    edge_pod_id: keypair.podId,
    edge_public_key: keypair.publicKeyClaim,
    edge_public_key_hex: keypair.publicKeyHex,
  }
  console.log(JSON.stringify(bundle, null, 2))
  console.error(
    `[edge-cli] Private key encrypted for pod ${keypair.podId} (not printed). Use deploy-edge with the same --derive-key-hex.`,
  )
}

async function cmdRegisterEdge(flags: Record<string, string | boolean>): Promise<void> {
  const host = flags['host']
  const portRaw = flags['port']
  if (typeof host !== 'string' || typeof portRaw !== 'string') {
    usage()
  }
  const port = Number(portRaw)
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('--port must be a positive integer')
  }

  const podId = typeof flags['pod-id'] === 'string' ? flags['pod-id'] : undefined
  const deriveKeyHex = resolveDeriveKeyHex(flags)
  const vault = makeDevVault(deriveKeyHex)

  let publicKeyClaim: string
  let edgePodId: string

  if (podId) {
    edgePodId = podId
    const settings = loadEdgeTierSettings()
    const existing = settings.replicas.find((r) => r.edge_pod_id === podId)
    if (existing) {
      publicKeyClaim = existing.edge_public_key
    } else {
      throw new Error(`No replica with pod-id ${podId}; run generate-keypair first`)
    }
  } else {
    const keypair = generateEdgeKeypair()
    edgePodId = keypair.podId
    publicKeyClaim = keypair.publicKeyClaim
    storeEncryptedEdgePrivateKey(keypair.podId, keypair.privateKeyHex, vault)
  }

  const ssoToken =
    (typeof flags['sso-token'] === 'string' && flags['sso-token']) ||
    process.env['WR_DESK_SSO_ACCESS_TOKEN'] ||
    ''
  if (!ssoToken) {
    throw new Error('Provide --sso-token or set WR_DESK_SSO_ACCESS_TOKEN')
  }

  const { jwt } = await requestSsoAttestation(publicKeyClaim, edgePodId, ssoToken)

  const replica: EdgeReplica = {
    host,
    port,
    edge_pod_id: edgePodId,
    edge_public_key: publicKeyClaim,
    sso_attestation_jwt: jwt,
  }
  const next = upsertEdgeReplica(replica)
  console.log(JSON.stringify({ registered: replica, replicas: next.replicas.length }, null, 2))
}

function resolveRemoteEdgeManifestPath(): string {
  if (process.env['BEAP_POD_REMOTE_EDGE_MANIFEST']) {
    return process.env['BEAP_POD_REMOTE_EDGE_MANIFEST']
  }
  return join(process.cwd(), 'packages', 'beap-pod', 'pod-remote-edge.yaml')
}

async function assertLinuxSshTarget(
  host: string,
  user: string,
  sshKeyPath: string,
): Promise<void> {
  const { stdout } = await execFileAsync(
    'ssh',
    ['-i', sshKeyPath, '-o', 'StrictHostKeyChecking=accept-new', `${user}@${host}`, 'uname', '-s'],
    { timeout: 30_000 },
  )
  const osName = stdout.trim()
  if (osName !== 'Linux') {
    throw new Error(`deploy-edge refuses non-Linux targets (got uname -s: ${osName || 'unknown'})`)
  }
}

async function cmdDeployEdge(flags: Record<string, string | boolean>): Promise<void> {
  const host = flags['host']
  const user = flags['user']
  const sshKey = flags['ssh-key']
  if (typeof host !== 'string' || typeof user !== 'string' || typeof sshKey !== 'string') {
    usage()
  }
  if (!existsSync(sshKey)) {
    throw new Error(`SSH key not found: ${sshKey}`)
  }

  await assertLinuxSshTarget(host, user, sshKey)

  const port = typeof flags['port'] === 'string' ? Number(flags['port']) : 18100
  const podId =
    typeof flags['pod-id'] === 'string'
      ? flags['pod-id']
      : loadEdgeTierSettings().replicas.find((r) => r.host === host && r.port === port)
          ?.edge_pod_id

  if (!podId) {
    throw new Error('Provide --pod-id or register-edge first for this host/port')
  }

  const settings = loadEdgeTierSettings()
  const replica = settings.replicas.find((r) => r.edge_pod_id === podId)
  if (!replica) {
    throw new Error(`No registered replica for pod-id ${podId}`)
  }

  const deriveKeyHex = resolveDeriveKeyHex(flags)
  const vault = makeDevVault(deriveKeyHex)
  const privateKeyHex = loadEncryptedEdgePrivateKeyHex(podId, vault)
  if (!privateKeyHex) {
    throw new Error(`Encrypted private key not found for pod-id ${podId}`)
  }

  const manifestPath = resolveRemoteEdgeManifestPath()
  const template = readFileSync(manifestPath, 'utf8')
  const podAuthSecret = randomBytes(32).toString('hex')

  const substituted = template
    .replace(/\$\{POD_AUTH_SECRET\}/g, podAuthSecret)
    .replace(/\$\{EDGE_PRIVATE_KEY_HEX\}/g, privateKeyHex)
    .replace(/\$\{EDGE_POD_ID\}/g, replica.edge_pod_id)
    .replace(/\$\{SSO_ATTESTATION_JWT\}/g, replica.sso_attestation_jwt)
    .replace(/\$\{CERT_TTL_SECONDS\}/g, '86400')

  const remoteScript = `set -euo pipefail
if ! command -v podman >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y && sudo apt-get install -y podman
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y podman
  else
    echo "podman not found and no supported package manager" >&2
    exit 1
  fi
fi
mkdir -p ~/.local/share/containers/seccomp
cat > /tmp/beap-remote-edge.yaml <<'BEAP_MANIFEST_EOF'
${substituted}
BEAP_MANIFEST_EOF
chmod 600 /tmp/beap-remote-edge.yaml
podman pod rm -f beap-pod-remote-edge 2>/dev/null || true
podman play kube /tmp/beap-remote-edge.yaml
rm -f /tmp/beap-remote-edge.yaml
echo "REMOTE_EDGE pod deployed on $(uname -s)"
`

  await execFileAsync(
    'ssh',
    ['-i', sshKey, '-o', 'StrictHostKeyChecking=accept-new', `${user}@${host}`, 'bash', '-s'],
    { input: remoteScript, timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
  )

  console.log(
    JSON.stringify(
      {
        deployed: true,
        host,
        port,
        edge_pod_id: replica.edge_pod_id,
        pod_name: 'beap-pod-remote-edge',
      },
      null,
      2,
    ),
  )
}

async function cmdEnableEdgeTier(enabled: boolean, flags: Record<string, string | boolean>): Promise<void> {
  const deriveKeyHex = resolveDeriveKeyHex(flags)
  const vault = makeDevVault(deriveKeyHex)
  const current = loadEdgeTierSettings()
  const next = { ...current, enabled }
  await applyEdgeTierSettingsAndRestartPod(vault, next)
  console.log(JSON.stringify({ enabled }, null, 2))
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const cmd = positional[0]
  if (!cmd) usage()

  switch (cmd) {
    case 'generate-keypair':
      await cmdGenerateKeypair(flags)
      break
    case 'register-edge':
      await cmdRegisterEdge(flags)
      break
    case 'deploy-edge':
      await cmdDeployEdge(flags)
      break
    case 'enable-edge-tier':
      await cmdEnableEdgeTier(true, flags)
      break
    case 'disable-edge-tier':
      await cmdEnableEdgeTier(false, flags)
      break
    default:
      usage()
  }
}

main().catch((err) => {
  console.error('[edge-cli]', (err as Error).message ?? err)
  process.exit(1)
})
