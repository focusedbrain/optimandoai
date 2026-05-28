import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runPodman } from './podman.js'

export const REMOTE_EDGE_POD_NAME = 'beap-pod-remote-edge'

export const REMOTE_EDGE_HEALTH_CHECKS = [
  { container: `${REMOTE_EDGE_POD_NAME}-ingestor`, port: 18100, hostLoopback: true },
  { container: `${REMOTE_EDGE_POD_NAME}-validator`, port: 18101 },
  { container: `${REMOTE_EDGE_POD_NAME}-depackager`, port: 18102 },
  { container: `${REMOTE_EDGE_POD_NAME}-pdf-parser`, port: 18107 },
  { container: `${REMOTE_EDGE_POD_NAME}-certifier`, port: 18104 },
  { container: `${REMOTE_EDGE_POD_NAME}-mail-fetcher`, port: 18106 },
] as const

export const DEFAULT_HEALTH_TIMEOUT_MS = 60_000
export const DEFAULT_HEALTH_POLL_MS = 2_000

export interface PodLaunchSecrets {
  readonly podAuthSecret: string
  readonly edgePrivateKeyHex: string
  readonly edgePodId: string
  readonly ssoAttestationJwt: string
  readonly certTtlSeconds: number
}

export function substituteManifest(template: string, env: Record<string, string>): string {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => env[name] ?? '')
}

export async function loadRemoteEdgeManifest(): Promise<string> {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const path = join(moduleDir, 'manifests', 'pod-remote-edge.yaml')
  return readFile(path, 'utf8')
}

export function buildLaunchEnv(secrets: PodLaunchSecrets): Record<string, string> {
  return {
    POD_AUTH_SECRET: secrets.podAuthSecret,
    EDGE_PRIVATE_KEY_HEX: secrets.edgePrivateKeyHex,
    EDGE_POD_ID: secrets.edgePodId,
    SSO_ATTESTATION_JWT: secrets.ssoAttestationJwt,
    CERT_TTL_SECONDS: String(secrets.certTtlSeconds),
  }
}

export async function podmanPlayKube(renderedYaml: string): Promise<{ ok: boolean; stderr: string }> {
  const { spawn } = await import('node:child_process')
  return new Promise((resolve) => {
    const proc = spawn('podman', ['play', 'kube', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HISTFILE: '/dev/null', HISTSIZE: '0' },
    })
    let stderr = ''
    proc.stderr.on('data', (c) => {
      stderr += String(c)
    })
    proc.on('close', (code) => {
      resolve({ ok: code === 0, stderr })
    })
    proc.stdin.write(renderedYaml)
    proc.stdin.end()
  })
}

export async function preDeployCleanup(podName = REMOTE_EDGE_POD_NAME): Promise<void> {
  await runPodman(['pod', 'rm', '-f', podName])
}

export type HealthProbeFn = (check: (typeof REMOTE_EDGE_HEALTH_CHECKS)[number]) => Promise<boolean>

export async function waitForAllContainersHealthy(
  probe: HealthProbeFn,
  options?: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  const pollMs = options?.pollMs ?? DEFAULT_HEALTH_POLL_MS
  const sleep = options?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let allOk = true
    for (const check of REMOTE_EDGE_HEALTH_CHECKS) {
      if (!(await probe(check))) {
        allOk = false
        break
      }
    }
    if (allOk) return true
    await sleep(pollMs)
  }
  return false
}
