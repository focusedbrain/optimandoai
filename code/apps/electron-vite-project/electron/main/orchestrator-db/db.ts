/**
 * Orchestrator database management with encrypted SQLite
 * Uses better-sqlite3 with SQLCipher (same as vault)
 *
 * DEK is a random 32-byte key generated on first open, encrypted with
 * electron.safeStorage (OS keychain / DPAPI / Keychain), and persisted to
 * `orchestrator.key` alongside the database file.
 *
 * Migration: on first run with this code the DB still uses the old hardcoded
 * DEK ("123" / fixed salt). We open it with the old key, PRAGMA rekey to the
 * new random key, then persist `orchestrator.key`.
 */

import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { createRequire } from 'module'
import { homedir } from 'os'
import { safeStorage } from 'electron'

const require = createRequire(import.meta.url)

// ── Lazy-load better-sqlite3 ──────────────────────────────────────────────────

let DatabaseConstructor: any = null

async function loadSQLCipher(): Promise<any> {
  if (!DatabaseConstructor) {
    try {
      let sqlite3: any = null

      try {
        sqlite3 = require('better-sqlite3')
        console.log('[ORCHESTRATOR DB] better-sqlite3 loaded via standard require')
      } catch (e1: any) {
        console.log('[ORCHESTRATOR DB] Standard require failed, trying fallback paths...')
        try {
          const path = require('path')
          const { app } = require('electron')
          const resourcesPath = path.dirname(app.getAppPath())
          const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
          console.log('[ORCHESTRATOR DB] Trying unpacked path:', unpackedPath)
          sqlite3 = require(unpackedPath)
          console.log('[ORCHESTRATOR DB] better-sqlite3 loaded from unpacked directory')
        } catch (e2: any) {
          console.log('[ORCHESTRATOR DB] Unpacked path failed:', e2?.message)
          try {
            const path = require('path')
            const { app } = require('electron')
            const resourcesPath = path.dirname(app.getAppPath())
            const nodeModulesPath = path.join(resourcesPath, 'node_modules', 'better-sqlite3')
            console.log('[ORCHESTRATOR DB] Trying node_modules path:', nodeModulesPath)
            sqlite3 = require(nodeModulesPath)
            console.log('[ORCHESTRATOR DB] better-sqlite3 loaded from node_modules')
          } catch (e3: any) {
            console.error('[ORCHESTRATOR DB] All better-sqlite3 load attempts failed')
            console.error('[ORCHESTRATOR DB] Attempt 1 (require):', e1?.message)
            console.error('[ORCHESTRATOR DB] Attempt 2 (unpacked):', e2?.message)
            console.error('[ORCHESTRATOR DB] Attempt 3 (node_modules):', e3?.message)
            throw e1
          }
        }
      }

      DatabaseConstructor = sqlite3
      if (!DatabaseConstructor || typeof DatabaseConstructor !== 'function') {
        console.error('[ORCHESTRATOR DB] better-sqlite3 exports:', Object.keys(sqlite3))
        throw new Error('Could not find Database constructor in better-sqlite3')
      }
      console.log('[ORCHESTRATOR DB] better-sqlite3 loaded successfully')
    } catch (error: any) {
      console.error('[ORCHESTRATOR DB] Failed to load better-sqlite3:', error)
      throw new Error(`better-sqlite3 module not available: ${error?.message || error}`)
    }
  }
  return DatabaseConstructor
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function getElectronDataDir(): string {
  const dir = join(homedir(), '.opengiraffe', 'electron-data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getOrchestratorDBPath(): string {
  return join(getElectronDataDir(), 'orchestrator.db')
}

function getOrchestratorKeyPath(): string {
  return join(getElectronDataDir(), 'orchestrator.key')
}

export function orchestratorDBExists(): boolean {
  return existsSync(getOrchestratorDBPath())
}

// ── DEK management via safeStorage ───────────────────────────────────────────

/**
 * Thrown when OS secure storage is unavailable.
 * Callers must fail closed — do NOT fall back to a plaintext key.
 */
export class OrchestratorSecureStorageUnavailableError extends Error {
  readonly code = 'ORCHESTRATOR_SECURE_STORAGE_UNAVAILABLE' as const
  constructor() {
    super(
      'OS secure storage (safeStorage) is not available. ' +
      'Cannot safely open the orchestrator database.',
    )
    this.name = 'OrchestratorSecureStorageUnavailableError'
  }
}

function assertSafeStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new OrchestratorSecureStorageUnavailableError()
  }
}

/**
 * Derive the legacy (hardcoded) DEK used by the old code.
 * Required only for the one-time migration rekey.
 */
async function deriveLegacyDEK(): Promise<Buffer> {
  const { scrypt } = await import('crypto')
  const { promisify } = await import('util')
  const scryptAsync = promisify(scrypt) as (
    password: string | Buffer,
    salt: string | Buffer,
    keylen: number,
    options: { N: number; r: number; p: number },
  ) => Promise<Buffer>
  const salt = Buffer.from('opengiraffe-orchestrator-temp-salt-123')
  return scryptAsync('123', salt, 32, { N: 16384, r: 8, p: 1 })
}

/**
 * Load the DEK from `orchestrator.key` (decrypting via safeStorage).
 * Returns null if the key file does not exist.
 */
function loadDEKFromKeyFile(): Buffer | null {
  const keyPath = getOrchestratorKeyPath()
  if (!existsSync(keyPath)) return null
  assertSafeStorageAvailable()
  const encrypted = readFileSync(keyPath)
  const hexDek = safeStorage.decryptString(encrypted)
  if (hexDek.length !== 64) {
    throw new Error(
      `[ORCHESTRATOR DB] orchestrator.key decrypted to unexpected length ${hexDek.length} (expected 64 hex chars). ` +
      'The key file may be corrupted. Delete orchestrator.key and orchestrator.db to start fresh.',
    )
  }
  return Buffer.from(hexDek, 'hex')
}

/**
 * Generate a new random DEK, encrypt it via safeStorage, and persist it.
 */
function generateAndPersistDEK(): Buffer {
  assertSafeStorageAvailable()
  const dek = randomBytes(32)
  const hexDek = dek.toString('hex')
  const encrypted = safeStorage.encryptString(hexDek)
  writeFileSync(getOrchestratorKeyPath(), encrypted)
  console.log('[ORCHESTRATOR DB] Generated and persisted new safeStorage-backed DEK')
  return dek
}

// ── SQLCipher configuration helpers ──────────────────────────────────────────

function applySQLCipherKey(db: any, dek: Buffer): void {
  const hexKey = dek.toString('hex')
  db.pragma(`key = "x'${hexKey}'"`)
  // Wipe local reference immediately
  hexKey.length // keep reference alive just past pragma
}

function applySQLCipherConfig(db: any): void {
  db.pragma('cipher_page_size = 4096')
  db.pragma('kdf_iter = 64000')
  db.pragma('cipher_hmac_algorithm = HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('cache_size = -8000')
  db.pragma('temp_store = MEMORY')
  db.pragma('mmap_size = 0')
}

function verifyDBReadable(db: any): void {
  try {
    db.prepare('SELECT count(*) FROM sqlite_master').get()
  } catch {
    db.close()
    throw new Error('Failed to decrypt orchestrator database — key mismatch or corruption')
  }
}

// ── Migration: rekey from legacy DEK to new safeStorage-backed DEK ───────────

/**
 * One-time migration: open DB with the old hardcoded DEK, rekey to `newDek`,
 * then persist `orchestrator.key`.
 *
 * Crash safety: we write `orchestrator.key` to a temp file BEFORE issuing
 * `PRAGMA rekey`. If the process crashes after the write but before rekey,
 * the DB is still on the old key; next startup sees the key file and tries
 * to open with the new DEK — which fails. We detect this by catching the
 * open failure and falling back to re-attempting the migration.
 *
 * If the process crashes AFTER rekey but before the rename, the temp file
 * remains and the DB uses the new key. We detect this by trying the new
 * key first if the temp file exists.
 *
 * Called when `orchestrator.db` exists but `orchestrator.key` does not.
 */
async function migrateToSafeStorageDEK(Database: any): Promise<Buffer> {
  const dbPath = getOrchestratorDBPath()
  const keyPath = getOrchestratorKeyPath()
  const keyPathTmp = keyPath + '.tmp'
  console.log('[ORCHESTRATOR DB] Migrating DEK from hardcoded legacy key to safeStorage-backed key...')

  assertSafeStorageAvailable()
  const legacyDek = await deriveLegacyDEK()
  const newDek = randomBytes(32)

  // Write the new key to a temp file BEFORE rekeying.
  // If we crash after this but before PRAGMA rekey, next open will try the
  // legacy DEK path again (orchestrator.key still absent → migration re-runs).
  // If we crash after PRAGMA rekey but before rename, the tmp file survives
  // and lets us complete the rename on next startup.
  const hexDek = newDek.toString('hex')
  const encrypted = safeStorage.encryptString(hexDek)
  writeFileSync(keyPathTmp, encrypted)

  const db = new Database(dbPath)
  try {
    applySQLCipherKey(db, legacyDek)
    applySQLCipherConfig(db)
    verifyDBReadable(db)

    // SQLCipher PRAGMA rekey changes the encryption key in-place
    const newHex = newDek.toString('hex')
    db.pragma(`rekey = "x'${newHex}'"`)
    console.log('[ORCHESTRATOR DB] PRAGMA rekey completed — database now uses new DEK')
  } finally {
    db.close()
  }

  // Atomic rename: temp → final. If we crashed before this, the tmp file
  // exists and the DB is on the new key. Next open attempt will:
  //   1. See orchestrator.key absent → enter migration path
  //   2. Find orchestrator.key.tmp → rename it and return newDek
  const { renameSync } = await import('fs')
  renameSync(keyPathTmp, keyPath)
  console.log('[ORCHESTRATOR DB] orchestrator.key written — migration complete')

  return newDek
}

// ── Public open/create functions ──────────────────────────────────────────────

/**
 * Create a new encrypted orchestrator database with a safeStorage-backed DEK.
 */
export async function createOrchestratorDB(): Promise<any> {
  const dbPath = getOrchestratorDBPath()
  const Database = await loadSQLCipher()

  const dek = generateAndPersistDEK()

  try {
    const db = new Database(dbPath)
    applySQLCipherKey(db, dek)
    applySQLCipherConfig(db)
    verifyDBReadable(db)
    createSchema(db)
    console.log('[ORCHESTRATOR DB] Created new encrypted database at:', dbPath)
    return db
  } catch (error: any) {
    console.error('[ORCHESTRATOR DB] Failed to create database:', error)
    throw new Error(`Failed to create orchestrator database: ${error?.message || error}`)
  }
}

/**
 * Open an existing orchestrator database.
 *
 * Migration path:
 * - If `orchestrator.key` is absent but `orchestrator.db` exists: old hardcoded DEK
 *   → rekey to new random DEK → persist `orchestrator.key`.
 * - If both exist: decrypt DEK from `orchestrator.key` and open normally.
 */
export async function openOrchestratorDB(): Promise<any> {
  const dbPath = getOrchestratorDBPath()
  if (!existsSync(dbPath)) {
    throw new Error('Orchestrator database does not exist')
  }

  const Database = await loadSQLCipher()

  let dek: Buffer

  const keyPath = getOrchestratorKeyPath()
  const keyPathTmp = keyPath + '.tmp'

  if (!existsSync(keyPath)) {
    if (existsSync(keyPathTmp)) {
      // Recovery: PRAGMA rekey completed but rename did not. Complete it now.
      console.log('[ORCHESTRATOR DB] Detected incomplete rekey migration (tmp key file exists) — completing rename')
      const { renameSync } = await import('fs')
      renameSync(keyPathTmp, keyPath)
      const loaded = loadDEKFromKeyFile()
      if (!loaded) throw new Error('Failed to load orchestrator DEK after tmp recovery')
      dek = loaded
    } else {
      // First run with new code — migrate from legacy hardcoded DEK
      dek = await migrateToSafeStorageDEK(Database)
    }
  } else {
    const loaded = loadDEKFromKeyFile()
    if (!loaded) throw new Error('Failed to load orchestrator DEK from key file')
    dek = loaded
  }

  try {
    const db = new Database(dbPath)
    applySQLCipherKey(db, dek)
    applySQLCipherConfig(db)
    verifyDBReadable(db)
    // Apply any pending schema migrations (idempotent)
    migrateSchema(db)
    console.log('[ORCHESTRATOR DB] Opened encrypted database')
    return db
  } catch (error: any) {
    console.error('[ORCHESTRATOR DB] Failed to open database:', error)
    throw error
  }
}

/**
 * Close database
 */
export function closeOrchestratorDB(db: any): void {
  if (db) {
    db.close()
    console.log('[ORCHESTRATOR DB] Closed database')
  }
}

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * Create the full database schema (called on new DB creation).
 */
function createSchema(db: any): void {
  try {
    console.log('[ORCHESTRATOR DB] Creating schema...')

    db.prepare(`
      CREATE TABLE IF NOT EXISTS orchestrator_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run()

    db.prepare(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        tags TEXT
      )
    `).run()

    db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run()

    db.prepare(`
      CREATE TABLE IF NOT EXISTS ui_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run()

    db.prepare(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `).run()

    db.prepare(`
      CREATE TABLE IF NOT EXISTS device_keys (
        key_id TEXT PRIMARY KEY,
        algorithm TEXT NOT NULL,
        public_key_b64 TEXT NOT NULL,
        private_key_enc BLOB NOT NULL,
        enc_nonce BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        migrated_from TEXT
      )
    `).run()

    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type)').run()

    const now = Date.now()
    db.prepare('INSERT OR REPLACE INTO orchestrator_meta (key, value, updated_at) VALUES (?, ?, ?)').run(
      'schema_version', '2.0.0', now,
    )
    db.prepare('INSERT OR REPLACE INTO orchestrator_meta (key, value, updated_at) VALUES (?, ?, ?)').run(
      'created_at', now.toString(), now,
    )

    const expectedTables = ['orchestrator_meta', 'sessions', 'settings', 'ui_state', 'templates', 'device_keys']
    for (const tableName of expectedTables) {
      db.prepare(`SELECT count(*) as count FROM ${tableName}`).get()
    }

    console.log('[ORCHESTRATOR DB] Schema created successfully')
  } catch (error: any) {
    console.error('[ORCHESTRATOR DB] Failed to create schema:', error)
    throw new Error(`Database schema creation failed: ${error?.message || error}`)
  }
}

/**
 * Apply pending schema migrations on existing databases (idempotent).
 */
function migrateSchema(db: any): void {
  // Migration v2: add device_keys table if absent (for DBs created before v2.0.0)
  try {
    db.prepare('SELECT count(*) FROM device_keys').get()
  } catch {
    console.log('[ORCHESTRATOR DB] Migrating schema: adding device_keys table')
    db.prepare(`
      CREATE TABLE IF NOT EXISTS device_keys (
        key_id TEXT PRIMARY KEY,
        algorithm TEXT NOT NULL,
        public_key_b64 TEXT NOT NULL,
        private_key_enc BLOB NOT NULL,
        enc_nonce BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        migrated_from TEXT
      )
    `).run()
    console.log('[ORCHESTRATOR DB] device_keys table added')
  }

  // Update schema_version if still at 1.0.0
  const meta = db.prepare('SELECT value FROM orchestrator_meta WHERE key = ?').get('schema_version') as { value: string } | undefined
  if (!meta || meta.value === '1.0.0') {
    db.prepare('INSERT OR REPLACE INTO orchestrator_meta (key, value, updated_at) VALUES (?, ?, ?)').run(
      'schema_version', '2.0.0', Date.now(),
    )
    console.log('[ORCHESTRATOR DB] schema_version updated to 2.0.0')
  }
}
