/**
 * Database management with native SQLCipher
 * Uses @journeyapps/sqlcipher for hardware-accelerated encryption
 */

import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { homedir } from 'os'

const require = createRequire(import.meta.url)

// Lazy-load better-sqlite3 to avoid module loading issues
let DatabaseConstructor: any = null

async function loadSQLCipher(): Promise<any> {
  if (!DatabaseConstructor) {
    try {
      // Load better-sqlite3 (works in dev and production)
      let sqlite3: any = null
      
      // First try: standard require (works in dev)
      try {
        sqlite3 = require('better-sqlite3')
        console.log('[VAULT DB] better-sqlite3 loaded via standard require')
      } catch (e1: any) {
        console.log('[VAULT DB] Standard require failed, trying fallback paths...')
        // Second try: from app.asar.unpacked (works in production)
        try {
          const path = require('path')
          const { app } = require('electron')
          // app.getAppPath() returns path to app.asar, so we go up one level to resources
          const resourcesPath = path.dirname(app.getAppPath())
          const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
          console.log('[VAULT DB] Trying unpacked path:', unpackedPath)
          sqlite3 = require(unpackedPath)
          console.log('[VAULT DB] better-sqlite3 loaded from unpacked directory')
        } catch (e2: any) {
          console.log('[VAULT DB] Unpacked path failed:', e2?.message)
          // Third try: from node_modules in app directory
          try {
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
            console.error('[VAULT DB] Attempt 2 (unpacked):', e2?.message)
            console.error('[VAULT DB] Attempt 3 (node_modules):', e3?.message)
            throw e1 // Throw the original error
          }
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
  const vaultMap = new Map<string, { id: string, name: string, created: number }>()
  
  // First, try to read from registry
  if (existsSync(registryPath)) {
    try {
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8'))
      if (registry.vaults && Array.isArray(registry.vaults)) {
        for (const vault of registry.vaults) {
          if (vault.id && vaultExists(vault.id)) {
            vaultMap.set(vault.id, {
              id: vault.id,
              name: vault.name || vault.id,
              created: vault.created || 0
            })
          }
        }
      }
    } catch (error) {
      console.warn('[VAULT DB] Failed to read vault registry, will scan directory:', error)
    }
  }
  
  // Also scan directory for vault database files to catch any that aren't in registry
  // Check both userData directory and electron-data subdirectory
  const directoriesToScan = [
    app.getPath('userData'), // Main userData directory
    join(app.getPath('userData'), 'electron-data'), // electron-data subdirectory
    join(homedir(), '.opengiraffe', 'electron-data') // Legacy path
  ]
  
  for (const vaultDataDir of directoriesToScan) {
    try {
      if (existsSync(vaultDataDir)) {
        const files = require('fs').readdirSync(vaultDataDir)
        const dbFiles = files.filter((f: string) => f.startsWith('vault_') && f.endsWith('.db'))
        
        for (const dbFile of dbFiles) {
          // Extract vault ID from filename: vault_vault_1234567890_abc123.db
          const match = dbFile.match(/^vault_(vault_\d+_[a-f0-9]+)\.db$/)
          if (match) {
            const vaultId = match[1]
            if (!vaultMap.has(vaultId)) {
              // Try to get name from meta file
              let vaultName = vaultId
              const metaPath = getVaultMetaPath(vaultId)
              if (existsSync(metaPath)) {
                try {
                  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
                  vaultName = meta.name || vaultId
                } catch (e) {
                  // Use ID as name if meta file can't be read
                }
              }
              
              vaultMap.set(vaultId, {
                id: vaultId,
                name: vaultName,
                created: 0 // Unknown creation time
              })
            }
          }
        }
      }
    } catch (error) {
      console.warn(`[VAULT DB] Failed to scan directory ${vaultDataDir}:`, error)
    }
  }
  
  // Fallback: check for default vault if no vaults found
  if (vaultMap.size === 0 && vaultExists('default')) {
    vaultMap.set('default', { id: 'default', name: 'Default Vault', created: 0 })
  }
  
  return Array.from(vaultMap.values())
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
  
  try {
    const Database = await loadSQLCipher()
    
    // Create database with better-sqlite3
    const db = new Database(vaultPath)
    
    // Set SQLCipher key using raw hex format (better-sqlite3 compatible)
    const hexKey = dek.toString('hex')
    db.pragma(`key = "x'${hexKey}'"`)
    
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
      const testResult = db.prepare('SELECT count(*) as count FROM sqlite_master').get()
      console.log('[VAULT DB] Encryption verified, sqlite_master accessible:', testResult)
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
    
    // Set SQLCipher key using raw hex format (better-sqlite3 compatible)
    const hexKey = dek.toString('hex')
    db.pragma(`key = "x'${hexKey}'"`)
    
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
