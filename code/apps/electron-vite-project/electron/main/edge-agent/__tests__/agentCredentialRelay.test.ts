import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRequire } from 'module'
import { randomUUID } from 'node:crypto'

import { generateAgentEncryptionKeypair } from '@repo/agent-credential-envelope'

import type { EdgeReplica } from '../../edge-tier/settings.js'
import { migrateHandshakeTables, insertHandshakeRecord } from '../../handshake/db.js'
import { buildEdgeIngestorHandshakeRecord } from '../persistEdgeIngestorHandshake.js'
import { HandshakeState } from '../../handshake/types.js'

const _require = createRequire(import.meta.url)
let Database: new (path: string) => { pragma: (s: string) => void; close: () => void }
let sqliteAvailable = false

try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
  sqliteAvailable = true
} catch {
  /* skip */
}

describe.skipIf(!sqliteAvailable)('agent credential relay (orchestrator)', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateHandshakeTables(db)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  test('relay uses handshake row bearer and encryption key', async () => {
    const kp = generateAgentEncryptionKeypair()
    const orchToken = randomUUID()
    const record = buildEdgeIngestorHandshakeRecord({
      orchestratorSub: 'user@test',
      orchestratorEmail: 'user@test',
      orchestratorWrdeskUserId: 'wr-1',
      orchestratorIss: 'iss',
      orchestratorPublicKey: 'a'.repeat(64),
      agentPublicKey: 'b'.repeat(64),
      fingerprint: 'aaaa-bbbb-cccc-dddd',
      p2pEndpoint: 'http://203.0.113.1:51249',
      orchestratorP2pAuthToken: orchToken,
      agentP2pAuthToken: randomUUID(),
      agentEncryptionPublicKeyB64: kp.publicKeyB64,
    })
    record.state = HandshakeState.ACTIVE
    insertHandshakeRecord(db, record)

    const replica: EdgeReplica = {
      host: '203.0.113.1',
      port: 18_100,
      edge_pod_id: randomUUID(),
      edge_public_key: 'ed25519:' + 'a'.repeat(64),
      sso_attestation_jwt: 'jwt',
      deployment_type: 'agent',
      handshake_id: record.handshake_id,
    }

    let authHeader: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        authHeader = (init?.headers as Record<string, string>)?.Authorization ?? null
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }),
    )

    const { agentApiRequest } = await import('../agentApiClient.js')
    await agentApiRequest(replica, 'POST', '/agent/credentials/activate', undefined, db)

    expect(authHeader).toBe(`Bearer ${orchToken}`)
  })
})
