import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'

import { routeAgentApi, type AgentApiDeps } from '../src/agent-api.js'
import { AgentStorage } from '../src/storage.js'
import { AgentLogRingBuffer } from '../src/log-stream/buffer.js'
import { bindAgentLogStream } from '../src/log-stream/emit.js'
import { EDGE_INGESTOR_HANDSHAKE_TYPE } from '../src/edgeIngestorHandshake.js'
import type { PodManager } from '../src/pod-manager.js'

function mockPodManager(state: string): PodManager {
  return {
    getState: () => state,
    recoverFromHalt: async () => undefined,
    activateCredentials: async () => undefined,
  } as unknown as PodManager
}

async function request(
  server: Server,
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const port = (server.address() as { port: number }).port
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

describe('agent log-stream API', () => {
  let server: Server
  const dirs: string[] = []

  afterEach(() => {
    server?.close()
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  async function pairedDeps(podState: string): Promise<AgentApiDeps> {
    const dir = mkdtempSync(join(tmpdir(), 'agent-log-api-'))
    dirs.push(dir)
    const storage = new AgentStorage(dir)
    const token = randomUUID()
    await storage.saveState({
      phase: 'paired',
      orchestratorP2pAuthToken: token,
      pairRecord: {
        handshakeId: randomUUID(),
        handshakeType: EDGE_INGESTOR_HANDSHAKE_TYPE,
        orchestratorSub: 'sub',
        orchestratorPublicKey: 'opk',
        agentPublicKey: 'apk',
        orchestratorNonce: 'on',
        agentNonce: 'an',
        fingerprint: 'fp',
        confirmedAt: new Date().toISOString(),
        initiatorDeviceRole: 'host',
        acceptorDeviceRole: 'edge_agent',
        agentEncryptionPublicKeyB64: 'x',
        p2pEndpoint: 'http://127.0.0.1:1',
        agentP2pAuthToken: randomUUID(),
        orchestratorP2pAuthToken: token,
      },
    })
    const logBuffer = new AgentLogRingBuffer(dir)
    bindAgentLogStream({ ringBuffer: logBuffer, agentStorage: storage })
    return {
      storage,
      logBuffer,
      podManager: mockPodManager(podState),
      getPodAuthSecret: () => null,
    }
  }

  it('poll and ack structured events', async () => {
    const deps = await pairedDeps('halted_by_anomaly')
    const token = (await deps.storage.loadState()).orchestratorP2pAuthToken!

    server = createServer((req, res) => void routeAgentApi(req, res, deps))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))

    const poll1 = await request(server, 'GET', '/agent/log-stream/poll', token)
    expect(poll1.status).toBe(200)

    const bad = await request(server, 'POST', '/agent/recover', 'bad-token', { reason: 'x' })
    expect(bad.status).toBe(401)

    const depsRunning = await pairedDeps('running')
    server.close()
    server = createServer((req, res) => void routeAgentApi(req, res, depsRunning))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const tokenRun = (await depsRunning.storage.loadState()).orchestratorP2pAuthToken!

    const recoverWrong = await request(server, 'POST', '/agent/recover', tokenRun, { reason: 'x' })
    expect(recoverWrong.status).toBe(409)

    server.close()
    server = createServer((req, res) => void routeAgentApi(req, res, deps))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))

    const recoverOk = await request(
      server,
      'POST',
      '/agent/recover',
      token,
      { reason: 'user clicked' },
    )
    expect(recoverOk.status).toBe(200)
    expect(recoverOk.json.status).toBe('recovery_started')
  })
})
