/**
 * Database management with native SQLCipher
 * Uses @journeyapps/sqlcipher for hardware-accelerated encryption
 */

import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { homedir } from 'os'
import type { SessionUserInfo } from '../../../src/auth/session'
import { hasVaultOwnerMetadata, vaultOwnerMatchesSession, type VaultOwnerRecord } from './vaultOwnerIdentity'

const require = createRequire(import.meta.url)

// Lazy-load better-sqlite3 to avoid module loading issues
let DatabaseConstructor: any = null

async function loadSQLCipher(): Promise<any> {
  if (!DatabaseConstructor) {
    try {
      // Load better-sqlite3 (works in dev and production)
      let sqlite3: any = null
      
      // First try: standard require (works in dev with flat node_modules)
      try {
        sqlite3 = require('better-sqlite3')
        console.log('[VAULT DB] better-sqlite3 loaded via standard require')
      } catch (e1: any) {
        console.log('[VAULT DB] Standard require failed, trying fallback paths...')

        // Second try: app-local node_modules (pnpm workspace — module not in flat node_modules)
        if (!sqlite3) try {
          const path = require('path')
          const appNodeModules = path.join(__dirname, '..', 'node_modules', 'better-sqlite3')
          console.log('[VAULT DB] Trying app node_modules path:', appNodeModules)
          sqlite3 = require(appNodeModules)
          console.log('[VAULT DB] better-sqlite3 loaded from app node_modules')
        } catch (e1b: any) {
          console.log('[VAULT DB] App node_modules failed:', e1b?.message)
        }

        // Third try: from app.asar.unpacked (works in production)
        if (!sqlite3) try {
          const path = require('path')
          const { app } = require('electron')
          const resourcesPath = path.dirname(app.getAppPath())
          const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
          console.log('[VAULT DB] Trying unpacked path:', unpackedPath)
          sqlite3 = require(unpackedPath)
          console.log('[VAULT DB] better-sqlite3 loaded from unpacked directory')
        } catch (e2: any) {
          console.log('[VAULT DB] Unpacked path failed:', e2?.message)
        }

        // Fourth try: from node_modules relative to app resources
        if (!sqlite3) try {
          const path = require('path')
          const { app } = require('electron')
          const resourcesPath = path.dirname(app.getAppPath())
          const nodeModulesPath = path.join(resourcesPath, 'node_modules', 'better-sqlite3')
          console.log('[VAULT DB] Trying node_modules path:', nodeModulesPath)
          sqlite3 = require(nodeModulesPath)
          console.log('[VAULT DB] better-sqlite3 loaded from node_modules')
        } catch (e3: any) {
          console.error('[VAULT DB] All better-sqlite3 load attempts failed')
          console.error('[VAULT DB] Attempt 1 (require):', e1?.message)
          throw e1
        }
      }
      
      // better-sqlite3 exports Database as default export
      DatabaseConstructor = sqlite3
      if (!DatabaseConstructor || typeof DatabaseConstructor !== 'function') {
        console.error('[VAULT DB] better-sqlite3 exports:', Object.keys(sqlite3))
        throw new Error('Could not find Database constructor in better-sqlite3')
      }
      console.log('[VAULT DB] better-sqlite3 loaded successfully, constructor type:', typeof DatabaseConstructor)
    } catch (error: any) {
      console.error('[VAULT DB] Failed to load better-sqlite3:', error)
      console.error('[VAULT DB] Error details:', error.message, error.stack)
      throw new Error(`better-sqlite3 module not available: ${error?.message || error}`)
    }
  }
  return DatabaseConstructor
}

/**
 * Get vault database file path
 */
export function getVaultPath(vaultId: string = 'default'): string {
  // Use .opengiraffe/electron-data directory for vault storage (consistent location)
  const vaultDataDir = join(homedir(), '.opengiraffe', 'electron-data')
  
  // Ensure directory exists
  if (!existsSync(vaultDataDir)) {
    mkdirSync(vaultDataDir, { recursive: true })
  }
  
  if (vaultId === 'default') {
    return join(vaultDataDir, 'vault.db')
  }
  return join(vaultDataDir, `vault_${vaultId}.db`)
}

/**
 * Get vault metadata file path (stores unencrypted metadata)
 */
export function getVaultMetaPath(vaultId: string = 'default'): string {
  const vaultDataDir = join(homedir(), '.opengiraffe', 'electron-data')
  
  if (vaultId === 'default') {
    return join(vaultDataDir, 'vault.meta.json')
  }
  return join(vaultDataDir, `vault_${vaultId}.meta.json`)
}

/**
 * Get vault registry path (stores list of all vaults)
 */
export function getVaultRegistryPath(): string {
  const vaultDataDir = join(homedir(), '.opengiraffe', 'electron-data')
  return join(vaultDataDir, 'vaults.json')
}

/** One vault row for UI: owned vaults, or marked legacy/foreign. */
export interface ListedVaultEntry {
  id: string
  name: string
  created: number
  /** No owner block on disk — pre–account-isolation vault */
  legacy_unclaimed?: boolean
  /** Must go through claim/migration before unlock */
  requires_migration?: boolean
  /** Another account owns this vault — hidden from main list (counted separately) */
  foreign_vault?: boolean
}

export interface ListVaultsAccountResult {
  /** Vaults the current account may use (unlocked as normal) */
  vaults: ListedVaultEntry[]
  /** Legacy: no owner metadata; not auto-claimed */
  legacyUnclaimed: ListedVaultEntry[]
  hiddenForeignCount: number
  totalScanned: number
}

/**
 * Read owner fields from unencrypted meta JSON (before crypto unlock).
 */
export function readVaultOwnerFromMetaFile(vaultId: string): Partial<VaultOwnerRecord> | null {
  const metaPath = getVaultMetaPath(vaultId)
  if (!existsSync(metaPath)) return null
  try {
    const j = JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, unknown>
    if (!j || typeof j !== 'object') return null
    if (!j.owner_sub && !j.owner_wrdesk_user_id) return null
    return {
      owner_wrdesk_user_id: String(j.owner_wrdesk_user_id || j.owner_sub || ''),
      owner_sub: String(j.owner_sub || ''),
      owner_iss: String(j.owner_iss || ''),
      owner_email: String(j.owner_email || ''),
      owner_email_verified: Boolean(j.owner_email_verified),
      owner_claimed_at: String(j.owner_claimed_at || ''),
      vault_schema_version: typeof j.vault_schema_version === 'number' ? j.vault_schema_version : 0,
    }
  } catch {
    return null
  }
}

/**
 * Check if vault database exists
 */
export function vaultExists(vaultId: string = 'default'): boolean {
  return existsSync(getVaultPath(vaultId))
}

type RegistryVault = {
  id: string
  name: string
  created: number
} & Partial<VaultOwnerRecord>

/**
 * Collect all vault ids from registry + directory scan (same as legacy listVaults).
 */
function collectAllVaultBaseRows(): Map<string, { id: string; name: string; created: number; registry?: RegistryVault }> {
  const registryPath = getVaultRegistryPath()
  const vaultMap = new Map<string, { id: string; name: string; created: number; registry?: RegistryVault }>()

  if (existsSync(registryPath)) {
    try {
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8'))
      if (registry.vaults && Array.isArray(registry.vaults)) {
        for (const vault of registry.vaults) {
          if (vault.id && vaultExists(vault.id)) {
            vaultMap.set(vault.id, {
              id: vault.id,
              name: vault.name || vault.id,
              created: vault.created || 0,
              registry: vault as RegistryVault,
            })
          }
        }
      }
    } catch (error) {
      console.warn('[VAULT DB] Failed to read vault registry, will scan directory:', error)
    }
  }

  const vaultDataDir = join(homedir(), '.opengiraffe', 'electron-data')
  try {
    if (existsSync(vaultDataDir)) {
      const files = require('fs').readdirSync(vaultDataDir)
      const dbFiles = files.filter((f: string) => f.startsWith('vault_') && f.endsWith('.db'))
      for (const dbFile of dbFiles) {
        const match = dbFile.match(/^vault_(vault_\d+_[a-f0-9]+)\.db$/)
        if (match) {
          const vaultId = match[1]
          if (!vaultMap.has(vaultId)) {
            let vaultName = vaultId
            const metaPath = getVaultMetaPath(vaultId)
            if (existsSync(metaPath)) {
              try {
                const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
                vaultName = meta.name || vaultId
              } catch {
                /* */
              }
            }
            vaultMap.set(vaultId, { id: vaultId, name: vaultName, created: 0 })
          }
        }
      }
    }
  } catch (error) {
    console.warn(`[VAULT DB] Failed to scan directory ${vaultDataDir}:`, error)
  }

  if (vaultMap.size === 0 && vaultExists('default')) {
    vaultMap.set('default', { id: 'default', name: 'Default Vault', created: 0 })
  }
  return vaultMap
}

/**
 * List vaults for the current SSO account. Foreign-owned vaults are not listed as usable;
 * legacy vaults (no owner metadata) are not auto-claimed.
 */
export function listVaultsForAccount(session: SessionUserInfo | null): ListVaultsAccountResult {
  const base = collectAllVaultBaseRows()
  const totalScanned = base.size
  const vaults: ListedVaultEntry[] = []
  const legacyUnclaimed: ListedVaultEntry[] = []
  let hiddenForeignCount = 0

  const currentW = session?.wrdesk_user_id || session?.sub || ''
  for (const row of base.values()) {
    const fromFile = readVaultOwnerFromMetaFile(row.id)
    const fromReg = row.registry
    const owner: Partial<VaultOwnerRecord> | null = hasVaultOwnerMetadata(fromFile)
      ? fromFile
      : fromReg && hasVaultOwnerMetadata(fromReg)
        ? {
            owner_wrdesk_user_id: String(fromReg.owner_wrdesk_user_id || fromReg.owner_sub || ''),
            owner_sub: String(fromReg.owner_sub || ''),
            owner_iss: String(fromReg.owner_iss || ''),
            owner_email: String(fromReg.owner_email || ''),
            owner_claimed_at: String(fromReg.owner_claimed_at || ''),
            vault_schema_version: typeof fromReg.vault_schema_version === 'number' ? fromReg.vault_schema_version : 0,
          }
        : null

    const entry: ListedVaultEntry = {
      id: row.id,
      name: row.name,
      created: row.created,
    }

    if (!owner || !hasVaultOwnerMetadata(owner)) {
      legacyUnclaimed.push({
        ...entry,
        legacy_unclaimed: true,
        requires_migration: true,
      })
      continue
    }

    if (!session) {
      hiddenForeignCount += 1
      continue
    }

    if (vaultOwnerMatchesSession(owner, session)) {
      vaults.push(entry)
    } else {
      hiddenForeignCount += 1
    }
  }

  console.log(
    '[VAULT_ACCOUNT_FILTER]',
    JSON.stringify({
      current_wrdesk_user_id: String(currentW).slice(0, 64),
      totalVaults: totalScanned,
      visibleVaults: vaults.length,
      hiddenForeignVaults: hiddenForeignCount,
      legacyUnclaimedVaults: legacyUnclaimed.length,
    }),
  )

  return { vaults, legacyUnclaimed, hiddenForeignCount, totalScanned }
}

/**
 * Register a new vault in the registry
 */
export function registerVault(vaultId: string, name: string, owner?: VaultOwnerRecord): void {
  const registryPath = getVaultRegistryPath()
  
  // Ensure directory exists
  try {
    mkdirSync(dirname(registryPath), { recursive: true })
  } catch (error) {
    // Directory might already exist
  }
  
  type RegRow = { id: string; name: string; created: number } & Partial<VaultOwnerRecord>
  let registry: { vaults: RegRow[] } = { vaults: [] }
  
  if (existsSync(registryPath)) {
    try {
      registry = JSON.parse(readFileSync(registryPath, 'utf-8'))
    } catch (error) {
      console.warn('[VAULT DB] Failed to read registry, creating new one')
    }
  }
  
  // Check if vault already registered
  if (!registry.vaults.find((v: any) => v.id === vaultId)) {
    const row: RegRow = {
      id: vaultId,
      name,
      created: Date.now(),
    }
    if (owner) {
      Object.assign(row, owner)
    }
    registry.vaults.push(row)
    
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))
    console.log('[VAULT DB] Registered vault:', vaultId)
  }
}

/**
 * Unregister a vault from the registry
 */
export function unregisterVault(vaultId: string): void {
  const registryPath = getVaultRegistryPath()
  if (!existsSync(registryPath)) {
    return
  }
  
  try {
    const registry = JSON.parse(readFileSync(registryPath, 'utf-8'))
    registry.vaults = registry.vaults.filter((v: any) => v.id !== vaultId)
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))
    console.log('[VAULT DB] Unregistered vault:', vaultId)
  } catch (error) {
    console.error('[VAULT DB] Failed to unregister vault:', error)
  }
}

/**
 * Create new encrypted vault database with SQLCipher
 */
export async function createVaultDB(dek: Buffer, vaultId: string = 'default'): Promise<any> {
  const vaultPath = getVaultPath(vaultId)
  
  try {
    const Database = await loadSQLCipher()
    
    // Create database with better-sqlite3
    const db = new Database(vaultPath)
    
    // Set SQLCipher key using raw hex format (better-sqlite3 compatible).
    // The hex string is ephemeral — used only for the pragma call, then
    // the local variable falls out of scope.  We cannot zeroize JS strings,
    // but we keep the scope as tight as possible.
    {
      const hexKey = dek.toString('hex')
      db.pragma(`key = "x'${hexKey}'"`)
      // hexKey falls out of scope here — shortest possible lifetime
    }
    
    // SQLCipher 4 configuration for security and compatibility
    db.pragma('cipher_page_size = 4096')
    db.pragma('kdf_iter = 64000') // SQLCipher 4 default
    db.pragma('cipher_hmac_algorithm = HMAC_SHA512')
    db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
    
    // Performance and durability settings
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma('cache_size = -8000') // 8MB cache
    db.pragma('temp_store = MEMORY')
    db.pragma('mmap_size = 0')
    
    // Verify encryption is working
    try {
      db.prepare('SELECT count(*) as count FROM sqlite_master').get()
    } catch (error) {
      db.close()
      throw new Error('Failed to initialize encrypted database - SQLCipher key may be invalid')
    }
    
    // Create schema
    createSchema(db)
    
    console.log('[VAULT DB] Created new better-sqlite3 vault database at:', vaultPath)
    return db
  } catch (error: any) {
    console.error('[VAULT DB] Failed to create vault database:', error)
    throw new Error(`Failed to create vault database: ${error?.message || error}`)
  }
}

/**
 * Open existing encrypted vault database
 */
export async function openVaultDB(dek: Buffer, vaultId: string = 'default'): Promise<any> {
  const vaultPath = getVaultPath(vaultId)
  
  if (!existsSync(vaultPath)) {
    throw new Error(`Vault does not exist: ${vaultId}`)
  }
  
  const Database = await loadSQLCipher()
  
  try {
    const db = new Database(vaultPath)
    
    // Set SQLCipher key — scoped to minimize hex string lifetime
    {
      const hexKey = dek.toString('hex')
      db.pragma(`key = "x'${hexKey}'"`)
    }
    
    // SQLCipher 4 configuration
    db.pragma('cipher_page_size = 4096')
    db.pragma('kdf_iter = 64000')
    db.pragma('cipher_hmac_algorithm = HMAC_SHA512')
    db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
    
    // Performance settings
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma('cache_size = -8000')
    db.pragma('temp_store = MEMORY')
    db.pragma('mmap_size = 0')
    
    // Test that the key is correct by running a query
    try {
      db.prepare('SELECT count(*) FROM sqlite_master').get()
    } catch (error) {
      db.close()
      throw new Error('Failed to decrypt vault - incorrect password')
    }
    
    // Run additive migration for envelope columns (safe on every open)
    migrateEnvelopeColumns(db)

    // Run additive migration for document vault table (safe on every open)
    migrateDocumentTable(db)

    // Run additive migration for handshake tables (safe on every open)
    try {
      const { migrateHandshakeTables } = await import('../handshake/db')
      migrateHandshakeTables(db)
    } catch (e: any) {
      console.warn('[VAULT DB] ⚠️ Could not run handshake migrations:', e?.message)
    }

    // Run additive migration for ingestion tables (safe on every open)
    try {
      const { migrateIngestionTables } = await import('../ingestion/persistenceDb')
      migrateIngestionTables(db)
    } catch (e: any) {
      console.warn('[VAULT DB] ⚠️ Could not run ingestion migrations:', e?.message)
    }

    // Run additive migration for HS Context Profile tables (safe on every open)
    migrateHsContextProfileTables(db)

    console.log('[VAULT DB] Opened better-sqlite3 vault database')
    return db
  } catch (error) {
    console.error('[VAULT DB] Failed to open vault:', error)
    throw new Error('Failed to decrypt vault - incorrect password')
  }
}

/**
 * Close database
 */
export function closeVaultDB(db: any): void {
  db.close()
  console.log('[VAULT DB] Closed vault database')
}

// ---------------------------------------------------------------------------
// Additive schema migration — Document Vault table
// ---------------------------------------------------------------------------
// Creates the vault_documents table if it doesn't exist.  Safe to call
// on every open (CREATE TABLE IF NOT EXISTS).

function migrateDocumentTable(db: any): void {
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS vault_documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL,
        wrapped_dek BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        notes TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run()
    console.log('[VAULT DB] ✅ vault_documents table ready')
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create vault_documents table:', e?.message)
  }

  // Content-addressing index for deduplication
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_docs_sha256 ON vault_documents(sha256)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_docs_created ON vault_documents(created_at)').run()
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create document indexes:', e?.message)
  }
}

// ---------------------------------------------------------------------------
// Additive schema migration — envelope encryption columns
// ---------------------------------------------------------------------------
// Safe to call on every open: each ALTER TABLE is guarded by a try/catch
// so already-existing columns are silently skipped.

function migrateEnvelopeColumns(db: any): void {
  const cols: Array<{ name: string; sql: string }> = [
    { name: 'wrapped_dek',    sql: 'ALTER TABLE vault_items ADD COLUMN wrapped_dek BLOB' },
    { name: 'ciphertext',     sql: 'ALTER TABLE vault_items ADD COLUMN ciphertext BLOB' },
    { name: 'record_type',    sql: "ALTER TABLE vault_items ADD COLUMN record_type TEXT" },
    { name: 'meta',           sql: "ALTER TABLE vault_items ADD COLUMN meta TEXT" },
    { name: 'schema_version', sql: 'ALTER TABLE vault_items ADD COLUMN schema_version INTEGER DEFAULT 1' },
  ]

  for (const col of cols) {
    try {
      db.prepare(col.sql).run()
      console.log(`[VAULT DB] ✅ Added column: ${col.name}`)
    } catch (e: any) {
      // "duplicate column name" means it already exists — expected & safe
      if (e?.message?.includes('duplicate column')) {
        // Silently ignore
      } else {
        console.warn(`[VAULT DB] ⚠️ Could not add column ${col.name}:`, e?.message)
      }
    }
  }

  // Index on schema_version for migration queries
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_items_schema_version ON vault_items(schema_version)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_items_record_type ON vault_items(record_type)').run()
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create envelope indexes:', e?.message)
  }
}

// ---------------------------------------------------------------------------
// Additive schema migration — HS Context Profile tables
// ---------------------------------------------------------------------------
// Creates hs_context_profiles and hs_context_profile_documents if they do
// not exist. Safe to call on every open (CREATE TABLE IF NOT EXISTS).

export function migrateHsContextProfileTables(db: any): void {
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hs_context_profiles (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        description TEXT,
        scope TEXT NOT NULL DEFAULT 'non_confidential'
          CHECK (scope IN ('non_confidential','confidential')),
        tags TEXT NOT NULL DEFAULT '[]',
        fields TEXT NOT NULL DEFAULT '{}',
        custom_fields TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      )
    `).run()
    console.log('[VAULT DB] ✅ hs_context_profiles table ready')
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create hs_context_profiles table:', e?.message)
  }

  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hs_profiles_org ON hs_context_profiles(org_id)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hs_profiles_archived ON hs_context_profiles(archived)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hs_profiles_updated ON hs_context_profiles(updated_at)').run()
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create hs_context_profiles indexes:', e?.message)
  }

  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hs_context_profile_documents (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES hs_context_profiles(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/pdf',
        storage_key TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'confidential',
        extraction_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (extraction_status IN ('pending','success','failed')),
        extracted_text TEXT,
        extracted_at INTEGER,
        extractor_name TEXT,
        error_message TEXT,
        sensitive INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `).run()
    console.log('[VAULT DB] ✅ hs_context_profile_documents table ready')
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create hs_context_profile_documents table:', e?.message)
  }

  // Additive migration: sensitive column for existing tables
  try {
    db.prepare('ALTER TABLE hs_context_profile_documents ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 0').run()
    console.log('[VAULT DB] ✅ hs_context_profile_documents.sensitive column added')
  } catch (e: any) {
    if (!/duplicate column|already exists/i.test(e?.message ?? '')) {
      console.warn('[VAULT DB] ⚠️ Could not add sensitive column:', e?.message)
    }
  }

  // Additive migration: label and document_type for labeled custom documents
  try {
    db.prepare('ALTER TABLE hs_context_profile_documents ADD COLUMN label TEXT').run()
    console.log('[VAULT DB] ✅ hs_context_profile_documents.label column added')
  } catch (e: any) {
    if (!/duplicate column|already exists/i.test(e?.message ?? '')) {
      console.warn('[VAULT DB] ⚠️ Could not add label column:', e?.message)
    }
  }
  try {
    db.prepare('ALTER TABLE hs_context_profile_documents ADD COLUMN document_type TEXT').run()
    console.log('[VAULT DB] ✅ hs_context_profile_documents.document_type column added')
  } catch (e: any) {
    if (!/duplicate column|already exists/i.test(e?.message ?? '')) {
      console.warn('[VAULT DB] ⚠️ Could not add document_type column:', e?.message)
    }
  }

  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hs_docs_profile ON hs_context_profile_documents(profile_id)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hs_docs_status ON hs_context_profile_documents(extraction_status)').run()
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create hs_context_profile_documents indexes:', e?.message)
  }

  // ── HS Context access approvals (whitelist for originals + links) ──
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hs_context_access_approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('document','link')),
        entity_id TEXT NOT NULL,
        handshake_id TEXT,
        actor_wrdesk_user_id TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        UNIQUE(entity_type, entity_id, actor_wrdesk_user_id)
      )
    `).run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hs_approvals_entity ON hs_context_access_approvals(entity_type, entity_id)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hs_approvals_actor ON hs_context_access_approvals(actor_wrdesk_user_id)').run()
    console.log('[VAULT DB] ✅ hs_context_access_approvals table ready')
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create hs_context_access_approvals:', e?.message)
  }

  // ── HS Context access audit ──
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hs_context_access_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        handshake_id TEXT,
        actor_wrdesk_user_id TEXT,
        outcome TEXT,
        metadata TEXT
      )
    `).run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hs_audit_timestamp ON hs_context_access_audit(timestamp)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hs_audit_entity ON hs_context_access_audit(entity_type, entity_id)').run()
    console.log('[VAULT DB] ✅ hs_context_access_audit table ready')
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create hs_context_access_audit:', e?.message)
  }

  // ── vault_settings: encrypted BYOK API key storage ──
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS vault_settings (
        key TEXT PRIMARY KEY,
        value_encrypted BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run()
    console.log('[VAULT DB] ✅ vault_settings table ready')
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create vault_settings table:', e?.message)
  }

  // ── Additive migration: error_code for structured failure handling ──
  try {
    db.prepare('ALTER TABLE hs_context_profile_documents ADD COLUMN error_code TEXT').run()
    console.log('[VAULT DB] ✅ hs_context_profile_documents.error_code column added')
  } catch (e: any) {
    if (!/duplicate column|already exists/i.test(e?.message ?? '')) {
      console.warn('[VAULT DB] ⚠️ Could not add error_code column:', e?.message)
    }
  }

  // ── Additive migration: page_count for document reader ──
  try {
    db.prepare('ALTER TABLE hs_context_profile_documents ADD COLUMN page_count INTEGER DEFAULT 0').run()
    console.log('[VAULT DB] ✅ hs_context_profile_documents.page_count column added')
  } catch (e: any) {
    if (!/duplicate column|already exists/i.test(e?.message ?? '')) {
      console.warn('[VAULT DB] ⚠️ Could not add page_count column:', e?.message)
    }
  }

  // ── Per-page extracted text for document reader ──
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hs_context_profile_document_pages (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES hs_context_profile_documents(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL,
        text TEXT NOT NULL,
        char_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(document_id, page_number)
      )
    `).run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hs_doc_pages_doc ON hs_context_profile_document_pages(document_id)').run()
    console.log('[VAULT DB] ✅ hs_context_profile_document_pages table ready')
  } catch (e: any) {
    console.warn('[VAULT DB] ⚠️ Could not create hs_context_profile_document_pages:', e?.message)
  }
}

/**
 * Create database schema
 */
function createSchema(db: any): void {
  try {
    console.log('[VAULT DB] Creating schema with individual prepare().run() calls...')
    
    // Test database is writable before creating schema
    try {
      const testWrite = db.prepare('CREATE TABLE IF NOT EXISTS test_table (id INTEGER)').run()
      console.log('[VAULT DB] Test table create result:', testWrite)
      db.prepare('DROP TABLE IF EXISTS test_table').run()
      console.log('[VAULT DB] Database is writable')
    } catch (testError: any) {
      console.error('[VAULT DB] Database is NOT writable:', testError?.message, testError?.code)
      throw new Error(`Database is not writable: ${testError?.message}`)
    }
    
    // Vault metadata table - use prepare().run() instead of exec()
    try {
      const result1 = db.prepare(`
        CREATE TABLE IF NOT EXISTS vault_meta (
          key TEXT PRIMARY KEY,
          value BLOB NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `).run()
      console.log('[VAULT DB] vault_meta table created, result:', result1)
    } catch (e: any) {
      console.error('[VAULT DB] Failed to create vault_meta:', e?.message, e?.code)
      throw e
    }
    
    // Containers table
    try {
      const result2 = db.prepare(`
        CREATE TABLE IF NOT EXISTS containers (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          favorite INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `).run()
      console.log('[VAULT DB] containers table created, result:', result2)
    } catch (e: any) {
      console.error('[VAULT DB] Failed to create containers:', e?.message, e?.code)
      throw e
    }
    
    // Vault items table
    try {
      const result3 = db.prepare(`
        CREATE TABLE IF NOT EXISTS vault_items (
          id TEXT PRIMARY KEY,
          container_id TEXT,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          domain TEXT,
          fields_json TEXT NOT NULL,
          favorite INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY(container_id) REFERENCES containers(id) ON DELETE CASCADE
        )
      `).run()
      console.log('[VAULT DB] vault_items table created, result:', result3)
    } catch (e: any) {
      console.error('[VAULT DB] Failed to create vault_items:', e?.message, e?.code)
      throw e
    }
    
    // Indexes for performance
    try {
      db.prepare('CREATE INDEX IF NOT EXISTS idx_items_container ON vault_items(container_id)').run()
      db.prepare('CREATE INDEX IF NOT EXISTS idx_items_domain ON vault_items(domain)').run()
      db.prepare('CREATE INDEX IF NOT EXISTS idx_items_category ON vault_items(category)').run()
      db.prepare('CREATE INDEX IF NOT EXISTS idx_items_favorite ON vault_items(favorite)').run()
      console.log('[VAULT DB] Indexes created')
    } catch (e: any) {
      console.warn('[VAULT DB] Failed to create indexes (non-critical):', e?.message)
    }

    // ── Envelope encryption columns (additive migration) ──
    // These columns are added with ALTER TABLE so that existing vaults
    // are upgraded transparently on first open after the update.
    migrateEnvelopeColumns(db)

    // ── Document Vault table ──
    migrateDocumentTable(db)

    // ── HS Context Profile tables ──
    migrateHsContextProfileTables(db)
    
    // Verify schema was created correctly
    // NOTE: sqlite_master queries return {} instead of [] with current SQLCipher config
    // So we verify each table directly instead
    console.log('[VAULT DB] Verifying schema by direct table queries...')
    
    const expectedTables = ['vault_meta', 'containers', 'vault_items']
    const missingTables: string[] = []
    
    for (const tableName of expectedTables) {
      try {
        const directCheck = db.prepare(`SELECT count(*) as count FROM ${tableName}`).get()
        console.log(`[VAULT DB] ✅ Table ${tableName} exists and is queryable:`, directCheck)
      } catch (directError: any) {
        console.error(`[VAULT DB] ❌ Table ${tableName} does NOT exist:`, directError?.message)
        missingTables.push(tableName)
      }
    }
    
    if (missingTables.length > 0) {
      throw new Error(`Schema creation failed: Missing tables: ${missingTables.join(', ')}`)
    }
    
    console.log('[VAULT DB] ✅ Schema created successfully. All tables verified.')
  } catch (error: any) {
    console.error('[VAULT DB] Failed to create schema:', error)
    throw new Error(`Database schema creation failed: ${error?.message || error}`)
  }
}
