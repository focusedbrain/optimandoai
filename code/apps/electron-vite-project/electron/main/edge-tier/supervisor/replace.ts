/**
 * Single-container replacement on REMOTE_EDGE pod (P5.4).
 *
 * Replace-not-restart: podman rm -f + podman run --pod (joins existing pod network).
 * On certain failures, escalates to whole-pod replacement (P5.8).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { EdgeReplica } from '../settings.js'
import type { EdgeTierPodVault } from '../podLifecycle.js'
import type { ReplicaActionSshRunner } from '../replicaActions.js'
import { loadEncryptedEdgePrivateKeyHex } from '../keyStorage.js'
import { redeliverAllReplicaCredentials } from '../rebootRecovery.js'
import {
  buildAllHealthCommand,
  buildContainerHealthCommand,
  buildPodRmCommand,
  buildPodStopCommand,
  buildPodmanPlayCommand,
  buildRemoveManifestCommand,
  DEFAULT_HEALTH_POLL_MS,
  DEFAULT_HEALTH_TIMEOUT_MS,
  REMOTE_MANIFEST_PATH,
  REMOTE_POD_NAME,
  shellQuote,
  wrapHistorySafe,
} from '../ssh/deploy.js'
import {
  findContainerSpec,
  REMOTE_EDGE_SUPERVISOR_CONTAINERS,
  type RemoteEdgeContainerRole,
  type RemoteEdgeContainerSpec,
} from './containers.js'
import { postRoleRestore } from './roleRemote.js'

export interface ReplacementResultSuccess {
  success: true
  new_container_id: string
  replacement_duration_ms: number
  escalated_to_pod?: boolean
  pod_escalation_reason?: string
}

export interface ReplacementResultFailure {
  success: false
  reason: string
  escalated_to_pod?: boolean
}

export type ReplacementResult = ReplacementResultSuccess | ReplacementResultFailure

export interface PodReplacementResultSuccess {
  success: true
  replacement_duration_ms: number
  escalation_reason: string
}

export interface PodReplacementResultFailure {
  success: false
  reason: string
  escalation_reason: string
}

export type PodReplacementResult = PodReplacementResultSuccess | PodReplacementResultFailure

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
  readManifestYaml?: () => string
  redeliverCredentials?: (
    replica: EdgeReplica,
    ssh: ReplicaActionSshRunner,
    vault: EdgeTierPodVault,
  ) => Promise<void>
}

const RESTORE_MAX_ATTEMPTS = 2
const RESTORE_RETRY_DELAY_MS = 500

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
    PDF_PARSER_BASE: 'http://127.0.0.1:18107',
    POD_VERSION: '1.0.0',
    DEPACKAGER_TIMEOUT_MS: '5000',
  },
  'pdf-parser': {
    BEAP_ROLE: 'pdf-parser',
    PORT: '18107',
    PDF_PARSER_HOST: '127.0.0.1',
    POD_VERSION: '1.0.0',
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
    MAIL_FETCHER_CREDENTIALS_DIR: '/var/lib/mail-fetcher',
    INGESTOR_BASE: 'http://127.0.0.1:18100',
    POD_VERSION: '1.0.0',
  },
}

const ROLE_RUN_USER: Record<RemoteEdgeContainerRole, string> = {
  ingestor: '10100:10100',
  validator: '10101:10100',
  depackager: '10102:10100',
  'pdf-parser': '10108:10100',
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

function readPodAuthSecretFromInspect(inspect: PodmanInspectEntry | null): string | null {
  const env = inspect?.Config?.Env ?? []
  for (const line of env) {
    if (line.startsWith('POD_AUTH_SECRET=')) {
      const value = line.slice('POD_AUTH_SECRET='.length).trim()
      return value.length > 0 ? value : null
    }
  }
  return null
}

async function readPodAuthSecretWithFallback(ssh: ReplicaActionSshRunner): Promise<string | null> {
  for (const spec of REMOTE_EDGE_SUPERVISOR_CONTAINERS) {
    const fromExec = await readPodAuthSecret(ssh, spec.containerName)
    if (fromExec) return fromExec
  }

  const ingestor = findContainerSpec('ingestor').containerName
  const inspectResult = await ssh.run(buildInspectContainerCommand(ingestor))
  if (inspectResult.code === 0) {
    const fromInspect = readPodAuthSecretFromInspect(parseInspect(inspectResult.stdout))
    if (fromInspect) return fromInspect
  }
  return null
}

function readRemoteEdgeManifestTemplate(): string {
  const fromEnv = process.env['BEAP_REMOTE_EDGE_MANIFEST']
  if (fromEnv) return readFileSync(fromEnv, 'utf8')
  return readFileSync(
    join(process.cwd(), 'packages', 'beap-pod', 'pod-remote-edge.yaml'),
    'utf8',
  )
}

/** Failure modes that trigger whole-pod replacement (P5.8). */
export function shouldEscalateToPodReplace(reason: string): boolean {
  if (reason === 'health_timeout') return true
  if (reason.startsWith('restore_failed:')) return true
  if (/podman_play_failed|pod_state_corrupt|invalid pod|no such pod|inconsistent state/i.test(reason)) {
    return true
  }
  if (reason.startsWith('podman_run_failed:')) {
    const detail = reason.slice('podman_run_failed:'.length)
    return /corrupt|invalid|state|no such pod|inconsistent/i.test(detail)
  }
  return false
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

export async function replacePod(
  args: ReplaceContainerArgs & { escalationReason: string },
  deps: ReplaceDeps = {},
): Promise<PodReplacementResult> {
  const started = Date.now()
  const sleep = deps.sleep ?? defaultSleep
  const healthTimeoutMs = deps.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  const healthPollMs = deps.healthPollMs ?? DEFAULT_HEALTH_POLL_MS
  const certTtlSeconds = args.certTtlSeconds ?? 86400
  const readManifest = deps.readManifestYaml ?? readRemoteEdgeManifestTemplate
  const redeliver = deps.redeliverCredentials ?? redeliverAllReplicaCredentials

  const podAuthSecret = await readPodAuthSecretWithFallback(args.ssh)
  if (!podAuthSecret) {
    return {
      success: false,
      reason: 'pod_auth_secret_unavailable',
      escalation_reason: args.escalationReason,
    }
  }

  const privateKeyHex = loadEncryptedEdgePrivateKeyHex(args.replica.edge_pod_id, args.vault)
  if (!privateKeyHex) {
    return {
      success: false,
      reason: 'edge_private_key_unavailable',
      escalation_reason: args.escalationReason,
    }
  }

  const manifestYaml = readManifest()
  await args.ssh.uploadContent(manifestYaml, REMOTE_MANIFEST_PATH)
  const chmodResult = await args.ssh.run(`chmod 600 ${REMOTE_MANIFEST_PATH}`)
  if (chmodResult.code !== 0) {
    return {
      success: false,
      reason: `manifest_chmod_failed:${chmodResult.code ?? 'unknown'}`,
      escalation_reason: args.escalationReason,
    }
  }

  const stopResult = await args.ssh.run(buildPodStopCommand())
  if (stopResult.code !== 0) {
    return {
      success: false,
      reason: `pod_stop_failed:${stopResult.stderr.trim() || stopResult.code}`,
      escalation_reason: args.escalationReason,
    }
  }

  const rmResult = await args.ssh.run(buildPodRmCommand())
  if (rmResult.code !== 0) {
    return {
      success: false,
      reason: `pod_rm_failed:${rmResult.stderr.trim() || rmResult.code}`,
      escalation_reason: args.escalationReason,
    }
  }

  const playCmd = buildPodmanPlayCommand({
    podAuthSecret,
    privateKeyHex,
    podId: args.replica.edge_pod_id,
    attestationJwt: args.replica.sso_attestation_jwt,
    certTtlSeconds,
    manifestPath: REMOTE_MANIFEST_PATH,
  })
  const playResult = await args.ssh.run(playCmd)
  if (playResult.code !== 0) {
    const detail = playResult.stderr.trim() || String(playResult.code)
    return {
      success: false,
      reason: `podman_play_failed:${detail}`,
      escalation_reason: args.escalationReason,
    }
  }

  const healthCmd = buildAllHealthCommand()
  const deadline = Date.now() + healthTimeoutMs
  let healthy = false
  while (Date.now() < deadline) {
    const healthResult = await args.ssh.run(healthCmd)
    if (healthResult.code === 0) {
      healthy = true
      break
    }
    await sleep(healthPollMs)
  }

  if (!healthy) {
    return {
      success: false,
      reason: 'pod_health_timeout',
      escalation_reason: args.escalationReason,
    }
  }

  await redeliver(args.replica, args.ssh, args.vault)

  await args.ssh.run(buildRemoveManifestCommand())

  return {
    success: true,
    replacement_duration_ms: Date.now() - started,
    escalation_reason: args.escalationReason,
  }
}

async function replaceContainerSingle(
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
    let restoreOk = false
    for (let attempt = 0; attempt < RESTORE_MAX_ATTEMPTS; attempt++) {
      const restore = await postRoleRestore(args.ssh, spec, args.queuePosition)
      if (restore.status === 200) {
        restoreOk = true
        break
      }
      if (attempt < RESTORE_MAX_ATTEMPTS - 1) {
        await sleep(RESTORE_RETRY_DELAY_MS)
      } else {
        return {
          success: false,
          reason: `restore_failed:HTTP_${restore.status}`,
        }
      }
    }
    if (!restoreOk) {
      return { success: false, reason: 'restore_failed:unknown' }
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

export async function replaceContainer(
  args: ReplaceContainerArgs,
  deps: ReplaceDeps = {},
): Promise<ReplacementResult> {
  const containerResult = await replaceContainerSingle(args, deps)
  if (containerResult.success) {
    return containerResult
  }

  if (!shouldEscalateToPodReplace(containerResult.reason)) {
    return containerResult
  }

  const podResult = await replacePod(
    { ...args, escalationReason: containerResult.reason },
    deps,
  )

  if (podResult.success) {
    return {
      success: true,
      new_container_id: REMOTE_POD_NAME,
      replacement_duration_ms: podResult.replacement_duration_ms,
      escalated_to_pod: true,
      pod_escalation_reason: podResult.escalation_reason,
    }
  }

  return {
    success: false,
    reason: `pod_escalation_failed:${podResult.reason}`,
    escalated_to_pod: true,
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
