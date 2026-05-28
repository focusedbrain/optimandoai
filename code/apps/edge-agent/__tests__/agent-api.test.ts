import { describe, test, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'

import { randomUUID } from 'node:crypto'

import {
  generateAgentEncryptionKeypair,
  wrapCredentialPlaintext,
} from '@repo/agent-credential-envelope'

import { routeAgentApi, type AgentApiDeps } from '../src/agent-api.js'
import { AgentStorage } from '../src/storage.js'
import { AgentLogRingBuffer } from '../src/log-stream/buffer.js'
import { EDGE_INGESTOR_HANDSHAKE_TYPE } from '../src/edgeIngestorHandshake.js'
import type { PodManager } from '../src/pod-manager.js'

function edgeIngestorPairRecord(orchToken: string) {
  return {
    handshakeId: randomUUID(),
    handshakeType: EDGE_INGESTOR_HANDSHAKE_TYPE,
    orchestratorSub: 'sub',
    orchestratorPublicKey: 'opk',
    agentPublicKey: 'apk',
    orchestratorNonce: 'on',
    agentNonce: 'an',
    fingerprint: 'fp',
    confirmedAt: new Date().toISOString(),
    initiatorDeviceRole: 'host' as const,
    acceptorDeviceRole: 'edge_agent' as const,
    agentEncryptionPublicKeyB64: 'x',
    p2pEndpoint: 'http://127.0.0.1:1',
    agentP2pAuthToken: randomUUID(),
    orchestratorP2pAuthToken: orchToken,
  }
}

function mockPodManager(): PodManager {
  return {
    getState: () => 'stopped',
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

describe('agent API', () => {
  let server: Server
  const dirs: string[] = []

  afterEach(() => {
    server?.close()
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  test('relay persists credentials with valid bearer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-api-'))
    dirs.push(dir)
    const storage = new AgentStorage(dir)
    const kp = generateAgentEncryptionKeypair()
    const orchToken = randomUUID()
    await storage.saveState({
      phase: 'paired',
      agentEncryptionPrivateKeyB64: kp.privateKeyB64,
      agentEncryptionPublicKeyB64: kp.publicKeyB64,
      orchestratorP2pAuthToken: orchToken,
      pairRecord: edgeIngestorPairRecord(orchToken),
    })

    const envelope = wrapCredentialPlaintext(
      kp.publicKeyB64,
      { encrypted_bundle: '{}', account_key_hex: 'e'.repeat(64) },
      'account:acct-1',
    )

    const logBuffer = new AgentLogRingBuffer(dir)
    const deps: AgentApiDeps = {
      storage,
      podManager: mockPodManager(),
      getPodAuthSecret: () => null,
      logBuffer,
    }
    server = createServer((req, res) => void routeAgentApi(req, res, deps))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))

    const bad = await request(server, 'POST', '/agent/credentials/relay', 'wrong', {})
    expect(bad.status).toBe(401)

    const ok = await request(
      server,
      'POST',
      '/agent/credentials/relay',
      orchToken,
      {
        account_id: 'acct-1',
        display_name: 'Test',
        provider: 'google',
        envelope,
      },
    )
    expect(ok.status).toBe(200)
    expect(ok.json.status).toBe('stored')

    const state = await storage.loadState()
    expect(state.accounts?.['acct-1']?.provider).toBe('google')
  })

  test('DELETE removes account', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-api-'))
    dirs.push(dir)
    const storage = new AgentStorage(dir)
    const orchToken = randomUUID()
    await storage.saveState({
      phase: 'paired',
      orchestratorP2pAuthToken: orchToken,
      pairRecord: edgeIngestorPairRecord(orchToken),
      accounts: {
        a1: {
          accountId: 'a1',
          displayName: 'A',
          provider: 'google',
          encryptedBundle: '{}',
          accountKeyEncB64: 'x',
          updatedAt: new Date().toISOString(),
        },
      },
    })
    const logBuffer = new AgentLogRingBuffer(dir)
    const deps: AgentApiDeps = {
      storage,
      podManager: mockPodManager(),
      getPodAuthSecret: () => null,
      logBuffer,
    }
    server = createServer((req, res) => void routeAgentApi(req, res, deps))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))

    const res = await request(server, 'DELETE', '/agent/credentials/a1', orchToken)
    expect(res.status).toBe(200)
    const state = await storage.loadState()
    expect(state.accounts?.a1).toBeUndefined()
  })
})
