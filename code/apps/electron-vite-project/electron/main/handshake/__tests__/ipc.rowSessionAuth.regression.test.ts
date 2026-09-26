/**
 * Regression: handshake.get / queryStatus / delete must apply row-level
 * session visibility (same rules as handshake.list). Unauthorized or
 * unauthenticated callers fail closed as HANDSHAKE_NOT_FOUND.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  handleHandshakeRPC,
  setSSOSessionProvider,
  _resetSSOSessionProvider,
} from '../ipc'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { insertHandshakeRecord, getHandshakeRecord } from '../db'
import { mockKeypairFields } from './mockKeypair'
import { ReasonCode, type HandshakeRecord, type SSOSession } from '../types'

const ISS = 'https://auth.optimando.ai'

function partySession(user: 'a' | 'b' | 'c'): SSOSession {
  return buildTestSession({
    wrdesk_user_id: `user-${user}`,
    email: `${user}@test.com`,
    sub: `sub-${user}`,
    iss: ISS,
  })
}

function standardHandshake(handshakeId: string): HandshakeRecord {
  return {
    handshake_id: handshakeId,
    relationship_id: 'rel-row-auth',
    state: 'ACTIVE',
    handshake_type: 'standard',
    initiator: {
      wrdesk_user_id: 'user-a',
      email: 'a@test.com',
      iss: ISS,
      sub: 'sub-a',
      email_verified: true,
    },
    acceptor: {
      wrdesk_user_id: 'user-b',
      email: 'b@test.com',
      iss: ISS,
      sub: 'sub-b',
      email_verified: true,
    },
    local_role: 'initiator',
    sharing_mode: 'reciprocal',
    reciprocal_allowed: true,
    tier_snapshot: { plan: 'free' },
    current_tier_signals: {},
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {},
    external_processing: 'none',
    created_at: new Date().toISOString(),
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '1.0',
    ...mockKeypairFields(),
  } as HandshakeRecord
}

describe('handshake IPC row-level session authorization', () => {
  let db: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    db = createHandshakeTestDb()
    migrateIngestionTables(db)
    _resetSSOSessionProvider()
    insertHandshakeRecord(db, standardHandshake('hs-row-1'))
  })

  test('party session can get / queryStatus the row', async () => {
    setSSOSessionProvider(() => partySession('a'))
    const get = await handleHandshakeRPC('handshake.get', { handshake_id: 'hs-row-1' }, db)
    expect(get.error).toBeUndefined()
    expect(get.record?.handshake_id).toBe('hs-row-1')

    const status = await handleHandshakeRPC('handshake.queryStatus', { handshakeId: 'hs-row-1' }, db)
    expect(status.reason).toBe(ReasonCode.OK)
    expect(status.record?.handshake_id).toBe('hs-row-1')
  })

  test('unrelated session cannot get / queryStatus / delete (fail-closed NOT_FOUND)', async () => {
    setSSOSessionProvider(() => partySession('c'))

    const get = await handleHandshakeRPC('handshake.get', { handshake_id: 'hs-row-1' }, db)
    expect(get.error).toBe('Handshake not found')
    expect(get.reason).toBe(ReasonCode.HANDSHAKE_NOT_FOUND)
    expect(get.record).toBeUndefined()

    const status = await handleHandshakeRPC('handshake.queryStatus', { handshakeId: 'hs-row-1' }, db)
    expect(status.reason).toBe(ReasonCode.HANDSHAKE_NOT_FOUND)
    expect(status.record).toBeNull()

    const del = await handleHandshakeRPC('handshake.delete', { handshakeId: 'hs-row-1' }, db)
    expect(del.success).toBe(false)
    expect(del.reason).toBe(ReasonCode.HANDSHAKE_NOT_FOUND)
    expect(getHandshakeRecord(db, 'hs-row-1')).not.toBeNull()
  })

  test('no SSO session cannot get / queryStatus / delete (fail-closed NOT_FOUND)', async () => {
    _resetSSOSessionProvider()

    const get = await handleHandshakeRPC('handshake.get', { handshake_id: 'hs-row-1' }, db)
    expect(get.reason).toBe(ReasonCode.HANDSHAKE_NOT_FOUND)

    const status = await handleHandshakeRPC('handshake.queryStatus', { handshakeId: 'hs-row-1' }, db)
    expect(status.reason).toBe(ReasonCode.HANDSHAKE_NOT_FOUND)
    expect(status.record).toBeNull()

    const del = await handleHandshakeRPC('handshake.delete', { handshakeId: 'hs-row-1' }, db)
    expect(del.success).toBe(false)
    expect(del.reason).toBe(ReasonCode.HANDSHAKE_NOT_FOUND)
    expect(getHandshakeRecord(db, 'hs-row-1')).not.toBeNull()
  })

  test('party session can delete a revoked row after visibility check', async () => {
    // deleteHandshakeRecord only allows REVOKED / EXPIRED / own PENDING_ACCEPT.
    insertHandshakeRecord(db, { ...standardHandshake('hs-row-revoked'), state: 'REVOKED' })
    setSSOSessionProvider(() => partySession('b'))
    const del = await handleHandshakeRPC('handshake.delete', { handshakeId: 'hs-row-revoked' }, db)
    expect(del.success).toBe(true)
    expect(del.reason).not.toBe(ReasonCode.HANDSHAKE_NOT_FOUND)
  })

  test('authorized party on ACTIVE gets delete policy error, not NOT_FOUND leak', async () => {
    setSSOSessionProvider(() => partySession('a'))
    const del = await handleHandshakeRPC('handshake.delete', { handshakeId: 'hs-row-1' }, db)
    expect(del.success).toBe(false)
    expect(del.reason).not.toBe(ReasonCode.HANDSHAKE_NOT_FOUND)
    expect(String(del.error || '')).toMatch(/revoked|expired|pending/i)
    expect(getHandshakeRecord(db, 'hs-row-1')).not.toBeNull()
  })
})
