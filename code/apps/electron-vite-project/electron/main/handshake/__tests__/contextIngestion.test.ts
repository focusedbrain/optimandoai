/**
 * Context Ingestion — Sensitive preservation and governance tests
 *
 * Verifies that vault_profile blocks with sensitive documents get
 * usage_policy.sensitive in governance so cloud AI/search filters exclude them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ingestContextBlocks, parseVaultProfileSensitive } from '../contextIngestion'
import { computeBlockHash, computeContextCommitment } from '../contextCommitment'
import { migrateHandshakeTables, insertHandshakeRecord } from '../db'
import { filterBlocksForCloudAI, filterBlocksForSearch } from '../contextGovernance'
import { createRequire } from 'module'

const _require = createRequire(import.meta.url)

/** Detect better-sqlite3 at load time; try creating DB to catch Node version mismatch */
const DB_AVAILABLE = (() => {
  try {
    const D = _require('better-sqlite3')
    const tmp = new D(':memory:')
    tmp.close()
    return true
  } catch {
    return false
  }
})()

let Database: any
try {
  Database = _require('better-sqlite3')
} catch {
  Database = null
}

let db: any

// Unit tests for parseVaultProfileSensitive (no DB required)
describe('parseVaultProfileSensitive', () => {
  it('returns true when any document has sensitive === true', () => {
    expect(parseVaultProfileSensitive({ documents: [{ sensitive: true }] })).toBe(true)
    expect(parseVaultProfileSensitive({ documents: [{ sensitive: false }, { sensitive: true }] })).toBe(true)
    expect(parseVaultProfileSensitive(JSON.stringify({ documents: [{ sensitive: true }] }))).toBe(true)
  })

  it('returns false when no document has sensitive === true', () => {
    expect(parseVaultProfileSensitive({ documents: [{ sensitive: false }] })).toBe(false)
    expect(parseVaultProfileSensitive({ documents: [] })).toBe(false)
    expect(parseVaultProfileSensitive({ profile: {} })).toBe(false)
  })

  it('returns false for older blocks without documents (backward compat)', () => {
    expect(parseVaultProfileSensitive({ profile: { id: 'hsp_1', name: 'Acme' } })).toBe(false)
    expect(parseVaultProfileSensitive(null)).toBe(false)
    expect(parseVaultProfileSensitive(undefined)).toBe(false)
  })

  it('returns false for invalid JSON', () => {
    expect(parseVaultProfileSensitive('not json')).toBe(false)
  })
})

beforeEach(() => {
  if (!Database) return
  try {
    db = new Database(':memory:')
  } catch {
    db = null
    return
  }
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)

  // Minimal handshake record for governance inference
  insertHandshakeRecord(db, {
    handshake_id: 'hs-test',
    relationship_id: 'rel-test',
    state: 'PENDING_ACCEPT',
    initiator: { email: 'a@test.com', wrdesk_user_id: 'u1', iss: 'iss', sub: 'sub' },
    acceptor: null,
    local_role: 'acceptor',
    sharing_mode: 'reciprocal',
    reciprocal_allowed: true,
    tier_snapshot: {},
    current_tier_signals: {},
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: { allowsCloudEscalation: false, allowsExport: false },
    external_processing: 'none',
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: null,
    counterparty_p2p_token: null,
    local_public_key: null,
    local_private_key: null,
    counterparty_public_key: null,
    receiver_email: null,
  })
})

afterEach(() => {
  db?.close()
})

function makeVaultProfileBlock(content: Record<string, unknown>) {
  const contentStr = JSON.stringify(content)
  const blockHash = computeBlockHash(contentStr)
  return {
    block_id: 'ctx-test-001',
    block_hash: blockHash,
    type: 'vault_profile',
    scope_id: 'initiator',
    content: contentStr,
  }
}

describe.skipIf(!DB_AVAILABLE)('contextIngestion — sensitive preservation (DB integration)', () => {
  it('ingesting vault_profile with sensitive document results in governance with sensitive: true', () => {
    const content = {
      profile: { id: 'hsp_1', name: 'Acme', fields: {} },
      documents: [
        { id: 'hsd_1', filename: 'contract.pdf', sensitive: false },
        { id: 'hsd_2', filename: 'nda.pdf', sensitive: true },
      ],
    }
    const block = makeVaultProfileBlock(content)
    const commitment = computeContextCommitment([block])

    ingestContextBlocks(db, {
      handshake_id: 'hs-test',
      relationship_id: 'rel-test',
      context_commitment: commitment,
      context_blocks: [block],
      publisher_id: 'u1',
    })

    const row = db.prepare(
      'SELECT governance_json FROM context_blocks WHERE block_id = ?'
    ).get('ctx-test-001') as { governance_json: string }
    expect(row).toBeDefined()
    const governance = JSON.parse(row.governance_json)
    expect(governance.usage_policy?.sensitive).toBe(true)
  })

  it('ingested sensitive block is excluded by filterBlocksForCloudAI', () => {
    const content = {
      profile: { id: 'hsp_1', name: 'Acme', fields: {} },
      documents: [{ id: 'hsd_1', filename: 'secret.pdf', sensitive: true }],
    }
    const block = makeVaultProfileBlock(content)
    const commitment = computeContextCommitment([block])

    ingestContextBlocks(db, {
      handshake_id: 'hs-test',
      relationship_id: 'rel-test',
      context_commitment: commitment,
      context_blocks: [block],
      publisher_id: 'u1',
    })

    const row = db.prepare(
      'SELECT governance_json FROM context_blocks WHERE block_id = ?'
    ).get('ctx-test-001') as { governance_json: string }
    const governance = JSON.parse(row.governance_json)
    const blocks = [{ governance }]
    const filtered = filterBlocksForCloudAI(blocks, { cloud_ai_allowed: true })
    expect(filtered).toHaveLength(0)
  })

  it('ingested sensitive block is excluded by filterBlocksForSearch', () => {
    const content = {
      profile: { id: 'hsp_1', name: 'Acme', fields: {} },
      documents: [{ id: 'hsd_1', filename: 'secret.pdf', sensitive: true }],
    }
    const block = makeVaultProfileBlock(content)
    const commitment = computeContextCommitment([block])

    ingestContextBlocks(db, {
      handshake_id: 'hs-test',
      relationship_id: 'rel-test',
      context_commitment: commitment,
      context_blocks: [block],
      publisher_id: 'u1',
    })

    const row = db.prepare(
      'SELECT governance_json FROM context_blocks WHERE block_id = ?'
    ).get('ctx-test-001') as { governance_json: string }
    const governance = JSON.parse(row.governance_json)
    const blocks = [{ governance }]
    const filtered = filterBlocksForSearch(blocks)
    expect(filtered).toHaveLength(0)
  })

  it('non-sensitive vault_profile block does not get sensitive in governance', () => {
    const content = {
      profile: { id: 'hsp_1', name: 'Acme', fields: {} },
      documents: [
        { id: 'hsd_1', filename: 'pricelist.pdf', sensitive: false },
      ],
    }
    const block = makeVaultProfileBlock(content)
    const commitment = computeContextCommitment([block])

    ingestContextBlocks(db, {
      handshake_id: 'hs-test',
      relationship_id: 'rel-test',
      context_commitment: commitment,
      context_blocks: [block],
      publisher_id: 'u1',
    })

    const row = db.prepare(
      'SELECT governance_json FROM context_blocks WHERE block_id = ?'
    ).get('ctx-test-001') as { governance_json: string }
    const governance = JSON.parse(row.governance_json)
    expect(governance.usage_policy?.sensitive).not.toBe(true)
  })

  it('older vault_profile without documents ingests safely (no sensitive)', () => {
    const content = {
      profile: { id: 'hsp_1', name: 'Acme', fields: {} },
    }
    const block = makeVaultProfileBlock(content)
    const commitment = computeContextCommitment([block])

    ingestContextBlocks(db, {
      handshake_id: 'hs-test',
      relationship_id: 'rel-test',
      context_commitment: commitment,
      context_blocks: [block],
      publisher_id: 'u1',
    })

    const row = db.prepare(
      'SELECT governance_json FROM context_blocks WHERE block_id = ?'
    ).get('ctx-test-001') as { governance_json: string }
    expect(row).toBeDefined()
    const governance = JSON.parse(row.governance_json)
    expect(governance.usage_policy?.sensitive).not.toBe(true)
  })
})
