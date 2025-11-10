/**
 * Database management with native SQLCipher
 * Uses @journeyapps/sqlcipher for hardware-accelerated encryption
 */

import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// Lazy-load SQLCipher to avoid module loading issues
let DatabaseConstructor: any = null

async function loadSQLCipher(): Promise<any> {
  if (!DatabaseConstructor) {
    try {
      // Use require for native module (works better than dynamic import in ES modules)
      const sqlcipher = require('@journeyapps/sqlcipher')
      // @journeyapps/sqlcipher exports Database as a named export
      DatabaseConstructor = sqlcipher.Database
      if (!DatabaseConstructor || typeof DatabaseConstructor !== 'function') {
        console.error('[VAULT DB] SQLCipher exports:', Object.keys(sqlcipher))
        throw new Error('Could not find Database constructor in @journeyapps/sqlcipher')
      }
      console.log('[VAULT DB] SQLCipher loaded successfully, constructor type:', typeof DatabaseConstructor)
    } catch (error: any) {
      console.error('[VAULT DB] Failed to load SQLCipher:', error)
      console.error('[VAULT DB] Error details:', error.message, error.stack)
      throw new Error(`SQLCipher module not available: ${error?.message || error}`)
    }
  }
  return DatabaseConstructor
}

/**
 * Get vault database file path
 */
export function getVaultPath(vaultId: string = 'default'): string {
  if (vaultId === 'default') {
    return join(app.getPath('userData'), 'vault.db')
  }
  return join(app.getPath('userData'), `vault_${vaultId}.db`)
}

/**
 * Get vault metadata file path (stores unencrypted metadata)
 */
export function getVaultMetaPath(vaultId: string = 'default'): string {
  if (vaultId === 'default') {
    return join(app.getPath('userData'), 'vault.meta.json')
  }
  return join(app.getPath('userData'), `vault_${vaultId}.meta.json`)
}

/**
 * Get vault registry path (stores list of all vaults)
 */
export function getVaultRegistryPath(): string {
  return join(app.getPath('userData'), 'vaults.json')
}

/**
 * Check if vault database exists
 */
export function vaultExists(vaultId: string = 'default'): boolean {
  return existsSync(getVaultPath(vaultId))
}

/**
 * List all available vaults with metadata
 */
export function listVaults(): Array<{ id: string, name: string, created: number }> {
  const registryPath = getVaultRegistryPath()
  if (!existsSync(registryPath)) {
    // Check for default vault for backward compatibility
    if (vaultExists('default')) {
      return [{ id: 'default', name: 'Default Vault', created: 0 }]
    }
    return []
  }
  
  try {
    const registry = JSON.parse(readFileSync(registryPath, 'utf-8'))
    return registry.vaults || []
  } catch (error) {
    console.error('[VAULT DB] Failed to read vault registry:', error)
    return []
  }
}

/**
 * Register a new vault in the registry
 */
export function registerVault(vaultId: string, name: string): void {
  const registryPath = getVaultRegistryPath()
  
  // Ensure directory exists
  try {
    mkdirSync(dirname(registryPath), { recursive: true })
  } catch (error) {
    // Directory might already exist
  }
  
  let registry: { vaults: Array<{ id: string, name: string, created: number }> } = { vaults: [] }
  
  if (existsSync(registryPath)) {
    try {
      registry = JSON.parse(readFileSync(registryPath, 'utf-8'))
    } catch (error) {
      console.warn('[VAULT DB] Failed to read registry, creating new one')
    }
  }
  
  // Check if vault already registered
  if (!registry.vaults.find((v: any) => v.id === vaultId)) {
    registry.vaults.push({
      id: vaultId,
      name,
      created: Date.now()
    })
    
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
  const Database = await loadSQLCipher()
  
  // Create database
  const db = new Database(vaultPath)
  
  // Set SQLCipher key (uses the DEK as the encryption key)
  const hexKey = dek.toString('hex')
  db.prepare(`PRAGMA key = "x'${hexKey}'"`).run()
  
  // SQLCipher configuration for maximum security
  db.prepare('PRAGMA cipher_page_size = 4096').run()
  db.prepare('PRAGMA kdf_iter = 256000').run()
  db.prepare('PRAGMA cipher_hmac_algorithm = HMAC_SHA512').run()
  db.prepare('PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512').run()
  
  // Performance and durability settings
  db.prepare('PRAGMA journal_mode = WAL').run()
  db.prepare('PRAGMA synchronous = FULL').run()
  db.prepare('PRAGMA foreign_keys = ON').run()
  
  // Create schema
  createSchema(db)
  
  console.log('[VAULT DB] Created new SQLCipher vault database')
  return db
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
    
    // Set SQLCipher key
    const hexKey = dek.toString('hex')
    db.prepare(`PRAGMA key = "x'${hexKey}'"`).run()
    
    // SQLCipher configuration
    db.prepare('PRAGMA cipher_page_size = 4096').run()
    db.prepare('PRAGMA kdf_iter = 256000').run()
    db.prepare('PRAGMA cipher_hmac_algorithm = HMAC_SHA512').run()
    db.prepare('PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512').run()
    
    // Performance settings
    db.prepare('PRAGMA journal_mode = WAL').run()
    db.prepare('PRAGMA synchronous = FULL').run()
    db.prepare('PRAGMA foreign_keys = ON').run()
    
    // Test that the key is correct by running a query
    try {
      db.prepare('SELECT count(*) FROM sqlite_master').get()
    } catch (error) {
      db.close()
      throw new Error('Failed to decrypt vault - incorrect password')
    }
    
    console.log('[VAULT DB] Opened SQLCipher vault database')
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

/**
 * Create database schema
 */
function createSchema(db: any): void {
  // Vault metadata table
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_meta (
      key TEXT PRIMARY KEY,
      value BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  
  // Containers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS containers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      favorite INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  
  // Vault items table
  db.exec(`
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
  `)
  
  // Indexes for performance
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_container ON vault_items(container_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_domain ON vault_items(domain)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_category ON vault_items(category)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_favorite ON vault_items(favorite)')
  
  console.log('[VAULT DB] Schema created')
}
