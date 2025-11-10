/**
 * Database management with sql.js and application-level encryption
 * Uses DEK to encrypt the entire database file
 */

import initSqlJs, { Database } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

let SQL: any = null

/**
 * Initialize sql.js
 */
async function initSQL() {
  if (!SQL) {
    SQL = await initSqlJs()
  }
  return SQL
}

/**
 * Encrypt database buffer with DEK using AES-256-GCM
 */
function encryptDB(data: Buffer, dek: Buffer): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', dek, nonce)
  
  const encrypted = Buffer.concat([
    cipher.update(data),
    cipher.final(),
  ])
  
  const authTag = cipher.getAuthTag()
  
  // Format: nonce (12) + encrypted data + authTag (16)
  return Buffer.concat([nonce, encrypted, authTag])
}

/**
 * Decrypt database buffer with DEK
 */
function decryptDB(encryptedData: Buffer, dek: Buffer): Buffer {
  const nonce = encryptedData.subarray(0, 12)
  const authTag = encryptedData.subarray(encryptedData.length - 16)
  const ciphertext = encryptedData.subarray(12, encryptedData.length - 16)
  
  const decipher = createDecipheriv('aes-256-gcm', dek, nonce)
  decipher.setAuthTag(authTag)
  
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
}

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
 * Create new encrypted vault database
 */
export async function createVaultDB(dek: Buffer): Promise<Database> {
  await initSQL()
  
  const db = new SQL.Database()
  
  // Create schema
  createSchema(db)
  
  // Save encrypted database
  saveVaultDB(db, dek)
  
  console.log('[VAULT DB] Created new vault database')
  return db
}

/**
 * Open existing encrypted vault database
 */
export async function openVaultDB(dek: Buffer): Promise<Database> {
  await initSQL()
  
  const vaultPath = getVaultPath()
  
  if (!existsSync(vaultPath)) {
    throw new Error('Vault does not exist')
  }
  
  try {
    const encryptedData = readFileSync(vaultPath)
    const decryptedData = decryptDB(encryptedData, dek)
    
    const db = new SQL.Database(decryptedData)
    
    console.log('[VAULT DB] Opened vault database')
    return db
  } catch (error) {
    console.error('[VAULT DB] Failed to open vault:', error)
    throw new Error('Failed to decrypt vault - incorrect password')
  }
}

/**
 * Save vault database (encrypt and write to disk)
 */
export function saveVaultDB(db: Database, dek: Buffer): void {
  const data = db.export()
  const buffer = Buffer.from(data)
  const encrypted = encryptDB(buffer, dek)
  
  const vaultPath = getVaultPath()
  writeFileSync(vaultPath, encrypted)
  
  console.log('[VAULT DB] Saved vault database')
}

/**
 * Create database schema
 */
function createSchema(db: Database): void {
  // Vault metadata table
  db.run(`
    CREATE TABLE IF NOT EXISTS vault_meta (
      key TEXT PRIMARY KEY,
      value BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  
  // Containers table
  db.run(`
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
  db.run(`
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
  db.run('CREATE INDEX IF NOT EXISTS idx_items_container ON vault_items(container_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_items_domain ON vault_items(domain)')
  db.run('CREATE INDEX IF NOT EXISTS idx_items_category ON vault_items(category)')
  db.run('CREATE INDEX IF NOT EXISTS idx_items_favorite ON vault_items(favorite)')
  
  console.log('[VAULT DB] Schema created')
}

/**
 * Close database (doesn't apply to sql.js, but kept for API compatibility)
 */
export function closeVaultDB(db: Database): void {
  db.close()
  console.log('[VAULT DB] Closed vault database')
}

