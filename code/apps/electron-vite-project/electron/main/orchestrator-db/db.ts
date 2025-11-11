/**
 * Orchestrator database management with encrypted SQLite
 * Uses better-sqlite3 with SQLCipher (same as vault)
 * Hardcoded password "123" for temporary auto-login
 */

import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { homedir } from 'os'

const require = createRequire(import.meta.url)

// Lazy-load better-sqlite3
let DatabaseConstructor: any = null

async function loadSQLCipher(): Promise<any> {
  if (!DatabaseConstructor) {
    try {
      let sqlite3: any = null
      
      // First try: standard require (works in dev)
      try {
        sqlite3 = require('better-sqlite3')
        console.log('[ORCHESTRATOR DB] better-sqlite3 loaded via standard require')
      } catch (e1: any) {
        console.log('[ORCHESTRATOR DB] Standard require failed, trying fallback paths...')
        // Second try: from app.asar.unpacked (works in production)
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
          // Third try: from node_modules in app directory
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

/**
 * Get orchestrator database file path
 */
export function getOrchestratorDBPath(): string {
  const dbDir = join(homedir(), '.opengiraffe', 'electron-data')
  
  // Ensure directory exists
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }
  
  return join(dbDir, 'orchestrator.db')
}

/**
 * Check if orchestrator database exists
 */
export function orchestratorDBExists(): boolean {
  return existsSync(getOrchestratorDBPath())
}

/**
 * Derive DEK from hardcoded password "123"
 * Uses scrypt with same parameters as vault for consistency
 */
async function deriveDEKFromPassword(password: string): Promise<Buffer> {
  const { scrypt } = await import('crypto')
  const { promisify } = await import('util')
  const scryptAsync = promisify(scrypt) as (password: string | Buffer, salt: string | Buffer, keylen: number, options: { N: number, r: number, p: number }) => Promise<Buffer>
  
  // Use a fixed salt for the hardcoded password (not secure, but acceptable for temporary solution)
  // In production with WR Login, this will be replaced with proper key derivation
  const salt = Buffer.from('opengiraffe-orchestrator-temp-salt-123')
  
  // Same scrypt params as vault
  const N = 16384  // CPU/memory cost
  const r = 8      // Block size
  const p = 1      // Parallelism
  
  console.log(`[ORCHESTRATOR DB] Deriving DEK with scrypt: N=${N}, r=${r}, p=${p}`)
  
  const key = await scryptAsync(password, salt, 32, { N, r, p })
  return key
}

/**
 * Create new encrypted orchestrator database
 */
export async function createOrchestratorDB(): Promise<any> {
  const dbPath = getOrchestratorDBPath()
  
  try {
    const Database = await loadSQLCipher()
    
    // Derive DEK from hardcoded password "123"
    const dek = await deriveDEKFromPassword('123')
    
    // Create database with better-sqlite3
    const db = new Database(dbPath)
    
    // Set SQLCipher key using raw hex format (better-sqlite3 compatible)
    const hexKey = dek.toString('hex')
    db.pragma(`key = "x'${hexKey}'"`)
    
    // SQLCipher 4 configuration (same as vault)
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
      console.log('[ORCHESTRATOR DB] Encryption verified, sqlite_master accessible:', testResult)
    } catch (error) {
      db.close()
      throw new Error('Failed to initialize encrypted database')
    }
    
    // Create schema
    createSchema(db)
    
    console.log('[ORCHESTRATOR DB] Created new encrypted database at:', dbPath)
    return db
  } catch (error: any) {
    console.error('[ORCHESTRATOR DB] Failed to create database:', error)
    throw new Error(`Failed to create orchestrator database: ${error?.message || error}`)
  }
}

/**
 * Open existing encrypted orchestrator database
 */
export async function openOrchestratorDB(): Promise<any> {
  const dbPath = getOrchestratorDBPath()
  
  if (!existsSync(dbPath)) {
    throw new Error('Orchestrator database does not exist')
  }
  
  const Database = await loadSQLCipher()
  
  try {
    const db = new Database(dbPath)
    
    // Derive DEK from hardcoded password "123"
    const dek = await deriveDEKFromPassword('123')
    
    // Set SQLCipher key
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
    
    // Test that the key is correct
    try {
      db.prepare('SELECT count(*) FROM sqlite_master').get()
    } catch (error) {
      db.close()
      throw new Error('Failed to decrypt orchestrator database')
    }
    
    console.log('[ORCHESTRATOR DB] Opened encrypted database')
    return db
  } catch (error) {
    console.error('[ORCHESTRATOR DB] Failed to open database:', error)
    throw new Error('Failed to open orchestrator database')
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

/**
 * Create database schema
 * All designed for easy export to JSON/YAML/MD
 */
function createSchema(db: any): void {
  try {
    console.log('[ORCHESTRATOR DB] Creating schema...')
    
    // Test database is writable
    try {
      db.prepare('CREATE TABLE IF NOT EXISTS test_table (id INTEGER)').run()
      db.prepare('DROP TABLE IF EXISTS test_table').run()
      console.log('[ORCHESTRATOR DB] Database is writable')
    } catch (testError: any) {
      console.error('[ORCHESTRATOR DB] Database is NOT writable:', testError?.message)
      throw new Error(`Database is not writable: ${testError?.message}`)
    }
    
    // Orchestrator metadata table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS orchestrator_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run()
    console.log('[ORCHESTRATOR DB] orchestrator_meta table created')
    
    // Sessions table - stores session configurations
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
    console.log('[ORCHESTRATOR DB] sessions table created')
    
    // Settings table - key-value store for application settings
    db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run()
    console.log('[ORCHESTRATOR DB] settings table created')
    
    // UI state table - temporary UI states
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ui_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run()
    console.log('[ORCHESTRATOR DB] ui_state table created')
    
    // Templates table - for future session template functionality
    db.prepare(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `).run()
    console.log('[ORCHESTRATOR DB] templates table created')
    
    // Indexes for performance
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at)').run()
    db.prepare('CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type)').run()
    console.log('[ORCHESTRATOR DB] Indexes created')
    
    // Insert initial metadata
    const now = Date.now()
    db.prepare('INSERT OR REPLACE INTO orchestrator_meta (key, value, updated_at) VALUES (?, ?, ?)').run(
      'schema_version',
      '1.0.0',
      now
    )
    db.prepare('INSERT OR REPLACE INTO orchestrator_meta (key, value, updated_at) VALUES (?, ?, ?)').run(
      'created_at',
      now.toString(),
      now
    )
    
    // Verify schema
    const expectedTables = ['orchestrator_meta', 'sessions', 'settings', 'ui_state', 'templates']
    const missingTables: string[] = []
    
    for (const tableName of expectedTables) {
      try {
        db.prepare(`SELECT count(*) as count FROM ${tableName}`).get()
        console.log(`[ORCHESTRATOR DB] ✅ Table ${tableName} exists`)
      } catch (error: any) {
        console.error(`[ORCHESTRATOR DB] ❌ Table ${tableName} missing:`, error?.message)
        missingTables.push(tableName)
      }
    }
    
    if (missingTables.length > 0) {
      throw new Error(`Schema creation failed: Missing tables: ${missingTables.join(', ')}`)
    }
    
    console.log('[ORCHESTRATOR DB] ✅ Schema created successfully')
  } catch (error: any) {
    console.error('[ORCHESTRATOR DB] Failed to create schema:', error)
    throw new Error(`Database schema creation failed: ${error?.message || error}`)
  }
}

