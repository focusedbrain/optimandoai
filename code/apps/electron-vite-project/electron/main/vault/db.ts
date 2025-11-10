/**
 * Database management with native SQLCipher
 * Uses @journeyapps/sqlcipher for hardware-accelerated encryption
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import Database from '@journeyapps/sqlcipher'

/**
 * Get vault database file path
 */
export function getVaultPath(): string {
  return join(app.getPath('userData'), 'vault.db')
}

/**
 * Get vault metadata file path (stores unencrypted metadata)
 */
export function getVaultMetaPath(): string {
  return join(app.getPath('userData'), 'vault.meta.json')
}

/**
 * Check if vault database exists
 */
export function vaultExists(): boolean {
  return existsSync(getVaultPath())
}

/**
 * Create new encrypted vault database with SQLCipher
 */
export function createVaultDB(dek: Buffer): any {
  const vaultPath = getVaultPath()
  
  // Create database
  const db = new (Database as any)(vaultPath)
  
  // Set SQLCipher key (uses the DEK as the encryption key)
  const hexKey = dek.toString('hex')
  db.pragma(`key = "x'${hexKey}'"`)
  
  // SQLCipher configuration for maximum security
  db.pragma('cipher_page_size = 4096')
  db.pragma('kdf_iter = 256000')
  db.pragma('cipher_hmac_algorithm = HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
  
  // Performance and durability settings
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
  
  // Create schema
  createSchema(db)
  
  console.log('[VAULT DB] Created new SQLCipher vault database')
  return db
}

/**
 * Open existing encrypted vault database
 */
export function openVaultDB(dek: Buffer): any {
  const vaultPath = getVaultPath()
  
  if (!existsSync(vaultPath)) {
    throw new Error('Vault does not exist')
  }
  
  try {
    const db = new (Database as any)(vaultPath)
    
    // Set SQLCipher key
    const hexKey = dek.toString('hex')
    db.pragma(`key = "x'${hexKey}'"`)
    
    // SQLCipher configuration
    db.pragma('cipher_page_size = 4096')
    db.pragma('kdf_iter = 256000')
    db.pragma('cipher_hmac_algorithm = HMAC_SHA512')
    db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
    
    // Performance settings
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    db.pragma('foreign_keys = ON')
    
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
