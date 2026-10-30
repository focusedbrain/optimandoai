/**
 * Phase 2 — acceptance test 5: key extraction (G6).
 *
 * Private key material (`local_private_key`, `local_x25519_private_key_b64`,
 * `local_mlkem768_secret_key_b64`) moves out of relationship rows into the
 * dedicated `handshake_key_store` via migration v73 (copy-before-null, one
 * transaction, idempotent). Post-migration:
 *  - old key columns on `handshakes` are NULL,
 *  - sign round-trips still pass on pre-existing relationships (keys are
 *    overlaid from the store on every read),
 *  - re-running the migration never clobbers extracted keys,
 *  - NEW writes route key material to the store, never back onto the row.
 */

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'

import {
  migrateHandshakeTables,
  insertHandshakeRecord,
  getHandshakeRecord,
  updateHandshakeRecord,
  getHandshakeKeys,
} from '../db'
import { generateSigningKeypair, signCapsuleHash, verifyCapsuleSignature } from '../signatureKeys'
import { buildActiveHandshakeRecord } from './helpers'

function fullyMigratedDb(): any {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  return db
}

/**
 * Produce a DB in the PRE-v73 shape: all migrations applied, then the
 * Phase-2 tables dropped and their bookkeeping rows removed — the state an
 * existing installation is in right before this build's migration runs.
 */
function preExtractionDb(): any {
  const db = fullyMigratedDb()
  db.prepare('DELETE FROM handshake_schema_migrations WHERE version >= 73').run()
  db.prepare('DROP TABLE handshake_key_store').run()
  db.prepare('DROP TABLE wr_high_water_versions').run()
  db.prepare('DROP TABLE wr_core_nonces').run()
  return db
}

function keyColumns(db: any, hsId: string) {
  return db
    .prepare(
      'SELECT local_private_key, local_x25519_private_key_b64, local_mlkem768_secret_key_b64 FROM handshakes WHERE handshake_id = ?',
    )
    .get(hsId) as {
    local_private_key: string | null
    local_x25519_private_key_b64: string | null
    local_mlkem768_secret_key_b64: string | null
  }
}

describe('Phase 2 — key extraction migration (G6)', () => {
  it('moves existing on-row keys into the key store; old columns nulled; reads overlay', () => {
    const db = preExtractionDb()
    const keypair = generateSigningKeypair()
    const record = buildActiveHandshakeRecord({
      handshake_id: 'hs-keyx-1',
      local_public_key: keypair.publicKey,
      local_private_key: keypair.privateKey,
      local_x25519_private_key_b64: 'x25519-priv-b64==',
      local_mlkem768_secret_key_b64: 'mlkem-secret-b64==',
    })
    insertHandshakeRecord(db, record)

    // Pre-migration shape: keys live on the relationship row.
    const before = keyColumns(db, 'hs-keyx-1')
    expect(before.local_private_key).toBe(keypair.privateKey)
    expect(before.local_x25519_private_key_b64).toBe('x25519-priv-b64==')
    expect(before.local_mlkem768_secret_key_b64).toBe('mlkem-secret-b64==')

    // The one-shot migration runs (v73 + v74 re-apply).
    migrateHandshakeTables(db)

    // Old columns retained but NULL.
    const after = keyColumns(db, 'hs-keyx-1')
    expect(after.local_private_key).toBeNull()
    expect(after.local_x25519_private_key_b64).toBeNull()
    expect(after.local_mlkem768_secret_key_b64).toBeNull()

    // Key store holds the material.
    const stored = getHandshakeKeys(db, 'hs-keyx-1')
    expect(stored?.local_private_key).toBe(keypair.privateKey)
    expect(stored?.local_x25519_private_key_b64).toBe('x25519-priv-b64==')
    expect(stored?.local_mlkem768_secret_key_b64).toBe('mlkem-secret-b64==')

    // Reads overlay the store — callers keep seeing a complete record.
    const read = getHandshakeRecord(db, 'hs-keyx-1')
    expect(read?.local_private_key).toBe(keypair.privateKey)
    expect(read?.local_x25519_private_key_b64).toBe('x25519-priv-b64==')
    expect(read?.local_mlkem768_secret_key_b64).toBe('mlkem-secret-b64==')
  })

  it('sign round-trip passes on a pre-existing relationship after migration', () => {
    const db = preExtractionDb()
    const keypair = generateSigningKeypair()
    insertHandshakeRecord(
      db,
      buildActiveHandshakeRecord({
        handshake_id: 'hs-keyx-sign',
        local_public_key: keypair.publicKey,
        local_private_key: keypair.privateKey,
      }),
    )
    migrateHandshakeTables(db)

    const record = getHandshakeRecord(db, 'hs-keyx-sign')!
    const capsuleHash = 'f'.repeat(64)
    const signature = signCapsuleHash(capsuleHash, record.local_private_key!)
    expect(verifyCapsuleSignature(capsuleHash, signature, record.local_public_key!)).toBe(true)
  })

  it('is idempotent: re-running the migration never clobbers extracted keys', () => {
    const db = preExtractionDb()
    const keypair = generateSigningKeypair()
    insertHandshakeRecord(
      db,
      buildActiveHandshakeRecord({
        handshake_id: 'hs-keyx-idem',
        local_public_key: keypair.publicKey,
        local_private_key: keypair.privateKey,
        local_x25519_private_key_b64: 'xpriv==',
      }),
    )
    migrateHandshakeTables(db)
    expect(getHandshakeKeys(db, 'hs-keyx-idem')?.local_private_key).toBe(keypair.privateKey)

    // Force the v73/v74 statements to execute AGAIN over the already-nulled
    // columns (the failure mode: a re-run overwriting stored keys with NULLs).
    db.prepare('DELETE FROM handshake_schema_migrations WHERE version >= 73').run()
    migrateHandshakeTables(db)

    const stored = getHandshakeKeys(db, 'hs-keyx-idem')
    expect(stored?.local_private_key).toBe(keypair.privateKey)
    expect(stored?.local_x25519_private_key_b64).toBe('xpriv==')
    expect(keyColumns(db, 'hs-keyx-idem').local_private_key).toBeNull()
  })

  it('routes NEW writes to the key store — key material never lands on the row', () => {
    const db = fullyMigratedDb()
    const keypair = generateSigningKeypair()
    insertHandshakeRecord(
      db,
      buildActiveHandshakeRecord({
        handshake_id: 'hs-keyx-new',
        local_public_key: keypair.publicKey,
        local_private_key: keypair.privateKey,
        local_mlkem768_secret_key_b64: 'mlkem==',
      }),
    )

    const cols = keyColumns(db, 'hs-keyx-new')
    expect(cols.local_private_key).toBeNull()
    expect(cols.local_mlkem768_secret_key_b64).toBeNull()
    expect(getHandshakeKeys(db, 'hs-keyx-new')?.local_private_key).toBe(keypair.privateKey)
    expect(getHandshakeRecord(db, 'hs-keyx-new')?.local_private_key).toBe(keypair.privateKey)

    // Updates keep the discipline.
    const record = getHandshakeRecord(db, 'hs-keyx-new')!
    const rotated = generateSigningKeypair()
    updateHandshakeRecord(db, { ...record, local_private_key: rotated.privateKey, local_public_key: rotated.publicKey })
    expect(keyColumns(db, 'hs-keyx-new').local_private_key).toBeNull()
    expect(getHandshakeKeys(db, 'hs-keyx-new')?.local_private_key).toBe(rotated.privateKey)
  })
})
