import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { migrateHandshakeTables, getHandshakeRecord } from '../../handshake/db.js'
import {
  _setSettingsPathForTest,
  _setUserDataDirForTest,
  loadEdgeTierSettings,
} from '../../edge-tier/settings.js'

vi.mock('../../../src/auth/session.js', () => ({
  getCachedUserInfo: () => ({
    sub: 'user@test',
    email: 'user@test',
    wrdesk_user_id: 'wr-1',
    iss: 'iss',
  }),
}))

import { migrateAgentReplicaStopgapsToHandshake } from '../agentReplicaStopgapMigration.js'

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

describe.skipIf(!sqliteAvailable)('agentReplicaStopgapMigration', () => {
  let userData: string
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'edge-mig-'))
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateHandshakeTables(db)
    _setUserDataDirForTest(userData)
    _setSettingsPathForTest(join(userData, 'edge-tier-settings.json'))
  })

  afterEach(() => {
    _setSettingsPathForTest(null)
    _setUserDataDirForTest(null)
    rmSync(userData, { recursive: true, force: true })
    db.close()
  })

  test('backfills handshake row and strips stopgap fields from saved settings', () => {
    const orch = randomUUID()
    const agent = randomUUID()
    writeFileSync(
      join(userData, 'edge-tier-settings.json'),
      JSON.stringify({
        enabled: 'pending',
        replicas: [
          {
            host: '203.0.113.1',
            port: 18100,
            edge_pod_id: 'pod-legacy',
            edge_public_key: 'ed25519:' + 'a'.repeat(64),
            sso_attestation_jwt: 'jwt',
            deployment_type: 'agent',
            agent_encryption_public_key_b64: 'dGVzdC14MjU1MTktcHViLWtleS1iNjQ=',
            p2p_endpoint: 'http://203.0.113.1:51249',
            agent_p2p_auth_token: agent,
            orchestrator_p2p_auth_token: orch,
          },
        ],
        on_edge_unreachable: 'hold',
        fallback_policy: 'reject',
        native_beap_routing: 'direct',
      }),
      'utf8',
    )

    const changed = migrateAgentReplicaStopgapsToHandshake(db)
    expect(changed).toBe(true)

    const settings = loadEdgeTierSettings()
    const replica = settings.replicas[0]!
    expect(replica.handshake_id).toBeTruthy()
    expect((replica as Record<string, unknown>).p2p_endpoint).toBeUndefined()

    const row = getHandshakeRecord(db, replica.handshake_id!)
    expect(row?.handshake_type).toBe('edge_ingestor')
    expect(row?.local_p2p_auth_token).toBe(orch)
    expect(row?.p2p_endpoint).toBe('http://203.0.113.1:51249')
  })
})
