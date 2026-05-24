/**
 * Single-container replacement on REMOTE_EDGE pod (P5.4).
 *
 * Replace-not-restart: podman rm -f + podman run --pod (joins existing pod network).
 */

import type { EdgeReplica } from '../settings.js'
import type { EdgeTierPodVault } from '../podLifecycle.js'
import type { ReplicaActionSshRunner } from '../replicaActions.js'
import { loadEncryptedEdgePrivateKeyHex } from '../keyStorage.js'
import {
  buildContainerHealthCommand,
  DEFAULT_HEALTH_POLL_MS,
  DEFAULT_HEALTH_TIMEOUT_MS,
  REMOTE_POD_NAME,
  shellQuote,
  wrapHistorySafe,
} from '../ssh/deploy.js'
import {
  findContainerSpec,
  type RemoteEdgeContainerRole,
  type RemoteEdgeContainerSpec,
} from './containers.js'
import { postRoleRestore } from './roleRemote.js'

export interface ReplacementResultSuccess {
  success: true
  new_container_id: string
  replacement_duration_ms: number
}

export interface ReplacementResultFailure {
  success: false
  reason: string
}

export type ReplacementResult = ReplacementResultSuccess | ReplacementResultFailure

export interface ReplaceContainerArgs {
  replica: EdgeReplica
  containerRole: RemoteEdgeContainerRole
  ssh: ReplicaActionSshRunner
  vault: EdgeTierPodVault
  queuePosition?: number
  certTtlSeconds?: number
}

export interface ReplaceDeps {
  sleep?: (ms: number) => Promise<void>
  healthTimeoutMs?: number
  healthPollMs?: number
}

interface PodmanInspectState {
  Status?: string
  Running?: boolean
}

interface PodmanInspectMount {
  Name?: string
  Source?: string
  Destination?: string
  Type?: string
}

interface PodmanInspectConfig {
  Image?: string
  User?: string
  Env?: string[]
}

interface PodmanInspectEntry {
  State?: PodmanInspectState
  Config?: PodmanInspectConfig
  Mounts?: PodmanInspectMount[]
}

const DEFAULT_IMAGE = 'beap-components:dev'

const ROLE_ENV_OVERRIDES: Record<
  RemoteEdgeContainerRole,
  Record<string, string>
> = {
  ingestor: {
    BEAP_ROLE: 'ingestor',
    POD_MODE: 'REMOTE_EDGE',
    PORT: '18100',
    VALIDATOR_BASE: 'http://127.0.0.1:18101',
    POD_VERSION: '1.0.0',
  },
  validator: {
    BEAP_ROLE: 'validator',
    POD_MODE: 'REMOTE_EDGE',
    PORT: '18101',
    DEPACKAGER_BASE: 'http://127.0.0.1:18102',
    POD_VERSION: '1.0.0',
  },
  depackager: {
    BEAP_ROLE: 'depackager',
    POD_MODE: 'REMOTE_EDGE',
    PORT: '18102',
    CERTIFIER_BASE: 'http://127.0.0.1:18104',
    POD_VERSION: '1.0.0',
    DEPACKAGER_TIMEOUT_MS: '5000',
  },
  certifier: {
    BEAP_ROLE: 'certifier',
    POD_MODE: 'REMOTE_EDGE',
    PORT: '18104',
    CERTIFIER_HOST: '127.0.0.1',
    POD_VERSION: '1.0.0',
  },
  'mail-fetcher': {
    BEAP_ROLE: 'mail-fetcher',
    POD_MODE: 'REMOTE_EDGE',
    PORT: '18106',
    MAIL_FETCHER_HOST: '127.0.0.1',
    MAIL_FETCHER_CREDENTIALS_DIR: '/tmp/mail-fetcher-credentials',
    INGESTOR_BASE: 'http://127.0.0.1:18100',
    POD_VERSION: '1.0.0',
  },
}

const ROLE_RUN_USER: Record<RemoteEdgeContainerRole, string> = {
  ingestor: '10100:10100',
  validator: '10101:10100',
  depackager: '10102:10100',
  certifier: '10104:10100',
  'mail-fetcher': '10106:10100',
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function readPodAuthSecret(
  ssh: ReplicaActionSshRunner,
  referenceContainer: string,
): Promise<string | null> {
  const result = await ssh.run(
    `podman exec ${referenceContainer} printenv POD_AUTH_SECRET 2>/dev/null || true`,
  )
  const secret = result.stdout.trim()
  return secret.length > 0 ? secret : null
}

function parseInspect(stdout: string): PodmanInspectEntry | null {
  try {
    const parsed = JSON.parse(stdout) as PodmanInspectEntry[] | PodmanInspectEntry
    if (Array.isArray(parsed)) return parsed[0] ?? null
    return parsed
  } catch {
    return null
  }
}

function buildVolumeArgs(mounts: PodmanInspectMount[] | undefined): string[] {
  if (!mounts?.length) return []
  const args: string[] = []
  for (const mount of mounts) {
    if (mount.Type !== 'volume' || !mount.Name || !mount.Destination) continue
    args.push('-v', `${mount.Name}:${mount.Destination}`)
  }
  return args
}

function buildEnvPairs(
  role: RemoteEdgeContainerRole,
  podAuthSecret: string,
  replica: EdgeReplica,
  privateKeyHex: string | null,
  certTtlSeconds: number,
): string[] {
  const pairs: Record<string, string> = {
    ...ROLE_ENV_OVERRIDES[role],
    POD_AUTH_SECRET: podAuthSecret,
  }
  if (role === 'certifier') {
    if (!privateKeyHex) {
      throw new Error('Edge private key unavailable for certifier replacement')
    }
    pairs['EDGE_PRIVATE_KEY_HEX'] = privateKeyHex
    pairs['EDGE_POD_ID'] = replica.edge_pod_id
    pairs['SSO_ATTESTATION_JWT'] = replica.sso_attestation_jwt
    pairs['CERT_TTL_SECONDS'] = String(certTtlSeconds)
  }
  return Object.entries(pairs).map(([key, value]) => `-e ${shellQuote(`${key}=${value}`)}`)
}

function buildPodmanRunCommand(
  spec: RemoteEdgeContainerSpec,
  inspect: PodmanInspectEntry | null,
  envArgs: string[],
): string {
  const image = inspect?.Config?.Image?.split('@')[0] ?? DEFAULT_IMAGE
  const user = inspect?.Config?.User ?? ROLE_RUN_USER[spec.role]
  const volumeArgs = buildVolumeArgs(inspect?.Mounts)
  const seccompArg =
    spec.role === 'certifier'
      ? `--security-opt seccomp=${shellQuote(process.env['BEAP_CERTIFIER_SECCOMP'] ?? '/root/.local/share/containers/seccomp/beap-certifier.json')}`
      : '--security-opt seccomp=runtime/default'

  const parts = [
    'podman run -d',
    `--name ${spec.containerName}`,
    `--pod ${REMOTE_POD_NAME}`,
    `--user ${user}`,
    '--read-only',
    '--cap-drop ALL',
    seccompArg,
    ...envArgs,
    ...volumeArgs,
    image,
  ]
  return wrapHistorySafe(parts.join(' '))
}

export function buildRemoveContainerCommand(containerName: string): string {
  return wrapHistorySafe(`podman rm -f ${containerName}`)
}

export function buildInspectContainerCommand(containerName: string): string {
  return `podman inspect ${containerName} --format ${shellQuote('{{json .}}')}`
}

export function buildContainerIdCommand(containerName: string): string {
  return `podman inspect ${containerName} --format ${shellQuote('{{.Id}}')}`
}

export async function replaceContainer(
  args: ReplaceContainerArgs,
  deps: ReplaceDeps = {},
): Promise<ReplacementResult> {
  const started = Date.now()
  const sleep = deps.sleep ?? defaultSleep
  const healthTimeoutMs = deps.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  const healthPollMs = deps.healthPollMs ?? DEFAULT_HEALTH_POLL_MS
  const spec = findContainerSpec(args.containerRole)
  const certTtlSeconds = args.certTtlSeconds ?? 86400

  const inspectResult = await args.ssh.run(buildInspectContainerCommand(spec.containerName))
  const inspect = inspectResult.code === 0 ? parseInspect(inspectResult.stdout) : null

  const podAuthSecret = await readPodAuthSecret(args.ssh, spec.authReferenceContainer)
  if (!podAuthSecret) {
    return { success: false, reason: 'pod_auth_secret_unavailable' }
  }

  let privateKeyHex: string | null = null
  if (args.containerRole === 'certifier') {
    privateKeyHex = loadEncryptedEdgePrivateKeyHex(args.replica.edge_pod_id, args.vault)
    if (!privateKeyHex) {
      return { success: false, reason: 'edge_private_key_unavailable' }
    }
  }

  const rmResult = await args.ssh.run(buildRemoveContainerCommand(spec.containerName))
  if (rmResult.code !== 0) {
    return { success: false, reason: `podman_rm_failed:${rmResult.stderr.trim() || rmResult.code}` }
  }

  let envArgs: string[]
  try {
    envArgs = buildEnvPairs(
      args.containerRole,
      podAuthSecret,
      args.replica,
      privateKeyHex,
      certTtlSeconds,
    )
  } catch (err) {
    return {
      success: false,
      reason: err instanceof Error ? err.message : 'env_build_failed',
    }
  }

  const runCmd = buildPodmanRunCommand(spec, inspect, envArgs)
  const runResult = await args.ssh.run(runCmd)
  if (runResult.code !== 0) {
    return { success: false, reason: `podman_run_failed:${runResult.stderr.trim() || runResult.code}` }
  }

  const deadline = Date.now() + healthTimeoutMs
  let healthy = false
  while (Date.now() < deadline) {
    const healthCmd = buildContainerHealthCommand(spec.containerName, spec.port)
    const healthResult = await args.ssh.run(healthCmd)
    if (healthResult.code === 0) {
      healthy = true
      break
    }
    await sleep(healthPollMs)
  }

  if (!healthy) {
    return { success: false, reason: 'health_timeout' }
  }

  if (args.queuePosition !== undefined) {
    const restore = await postRoleRestore(args.ssh, spec, args.queuePosition)
    if (restore.status !== 200) {
      return {
        success: false,
        reason: `restore_failed:HTTP_${restore.status}`,
      }
    }
  }

  const idResult = await args.ssh.run(buildContainerIdCommand(spec.containerName))
  const newContainerId = idResult.stdout.trim() || spec.containerName

  return {
    success: true,
    new_container_id: newContainerId,
    replacement_duration_ms: Date.now() - started,
  }
}

export async function inspectContainerStatus(
  ssh: ReplicaActionSshRunner,
  containerName: string,
): Promise<'running' | 'exited' | 'missing' | 'unknown'> {
  const result = await ssh.run(buildInspectContainerCommand(containerName))
  if (result.code !== 0) {
    if (/no such object|not found/i.test(result.stderr)) return 'missing'
    return 'unknown'
  }
  const inspect = parseInspect(result.stdout)
  const status = inspect?.State?.Status?.toLowerCase()
  if (status === 'running') return 'running'
  if (status === 'exited' || status === 'stopped') return 'exited'
  if (inspect?.State?.Running === true) return 'running'
  if (inspect?.State?.Running === false) return 'exited'
  return 'unknown'
}
