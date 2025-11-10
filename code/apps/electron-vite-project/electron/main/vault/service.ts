/**
 * Vault Service - Core business logic for password manager
 * Handles unlock, lock, CRUD operations, session management, and autolock
 */

import { Database } from 'sql.js'
import { randomBytes } from 'crypto'
import type { Container, VaultItem, VaultSession, VaultStatus, VaultSettings, Field } from './types'
import {
  deriveKEK,
  wrapDEK,
  unwrapDEK,
  generateRandomKey,
  generateSalt,
  zeroize,
  deriveFieldKey,
  encryptField,
  decryptField,
  DEFAULT_KDF_PARAMS,
  type KDFParams,
} from './crypto'
import {
  createVaultDB,
  openVaultDB,
  saveVaultDB,
  closeVaultDB,
  vaultExists,
  getVaultPath,
  getVaultMetaPath,
} from './db'
import { readFileSync, writeFileSync } from 'fs'

export class VaultService {
  private db: Database | null = null
  private session: VaultSession | null = null
  private autoLockTimer: NodeJS.Timeout | null = null
  private settings: VaultSettings = {
    autoLockMinutes: 30, // Default: 30 minutes
  }
  
  // Rate limiting
  private unlockAttempts: number[] = [] // Timestamps
  private rpcCallCount: number = 0
  private rpcResetTimer: NodeJS.Timeout | null = null

  constructor() {
    console.log('[VAULT] VaultService initialized')
    console.log('[VAULT] Vault path:', getVaultPath())
  }

  // ==========================================================================
  // Vault Creation & Unlock
  // ==========================================================================

  /**
   * Create a new vault with master password
   */
  async createVault(masterPassword: string): Promise<void> {
    if (vaultExists()) {
      throw new Error('Vault already exists')
    }

    console.log('[VAULT] Creating new vault...')

    // Generate salt and DEK
    const salt = generateSalt()
    const dek = generateRandomKey()

    // Derive KEK from master password
    const kek = await deriveKEK(masterPassword, salt, DEFAULT_KDF_PARAMS)

    // Wrap DEK with KEK
    const wrappedDEK = await wrapDEK(dek, kek)

    // Zeroize KEK
    zeroize(kek)

    // Create database
    this.db = await createVaultDB(dek)

    // Store vault metadata
    this.saveVaultMeta(salt, wrappedDEK, DEFAULT_KDF_PARAMS)

    // Store settings
    this.saveSettings()

    // Save database
    saveVaultDB(this.db, dek)

    // Create session
    this.session = {
      vmk: dek,
      extensionToken: this.generateToken(),
      lastActivity: Date.now(),
    }

    this.startAutoLockTimer()

    console.log('[VAULT] ✅ Vault created successfully')
  }

  /**
   * Unlock existing vault with master password
   */
  async unlock(masterPassword: string): Promise<string> {
    if (!vaultExists()) {
      throw new Error('Vault does not exist')
    }

    if (this.session) {
      throw new Error('Vault is already unlocked')
    }

    // Rate limiting: max 5 attempts per minute
    this.cleanupUnlockAttempts()
    if (this.unlockAttempts.length >= 5) {
      throw new Error('Too many unlock attempts. Please wait a minute.')
    }

    this.unlockAttempts.push(Date.now())

    console.log('[VAULT] Unlocking vault...')

    // Load metadata (without opening DB)
    const { salt, wrappedDEK, kdfParams } = this.loadVaultMetaRaw()

    // Derive KEK
    const kek = await deriveKEK(masterPassword, salt, kdfParams)

    // Unwrap DEK
    let dek: Buffer
    try {
      dek = await unwrapDEK(wrappedDEK, kek)
    } catch (error) {
      zeroize(kek)
      throw new Error('Incorrect password')
    }

    zeroize(kek)

    // Open database
    try {
      this.db = await openVaultDB(dek)
    } catch (error) {
      zeroize(dek)
      throw new Error('Failed to open vault database')
    }

    // Load settings
    this.loadSettings()

    // Create session
    this.session = {
      vmk: dek,
      extensionToken: this.generateToken(),
      lastActivity: Date.now(),
    }

    this.startAutoLockTimer()

    console.log('[VAULT] ✅ Vault unlocked successfully')
    return this.session.extensionToken
  }

  /**
   * Lock vault (clear session and close database)
   */
  lock(): void {
    if (!this.session) {
      console.log('[VAULT] Vault already locked')
      return
    }

    console.log('[VAULT] Locking vault...')

    // Save database before closing
    if (this.db && this.session.vmk) {
      try {
        saveVaultDB(this.db, this.session.vmk)
      } catch (error) {
        console.error('[VAULT] Error saving database:', error)
      }
    }

    // Close database
    if (this.db) {
      closeVaultDB(this.db)
      this.db = null
    }

    // Zeroize DEK
    if (this.session.vmk) {
      zeroize(this.session.vmk)
    }

    // Clear session
    this.session = null

    // Stop autolock timer
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer)
      this.autoLockTimer = null
    }

    console.log('[VAULT] ✅ Vault locked')
  }

  /**
   * Get vault status
   */
  getStatus(): VaultStatus {
    return {
      exists: vaultExists(),
      locked: !this.session,
      autoLockMinutes: this.settings.autoLockMinutes,
    }
  }

  // ==========================================================================
  // Container Operations
  // ==========================================================================

  /**
   * Create a container (company or identity)
   */
  createContainer(type: Container['type'], name: string, favorite: boolean = false): Container {
    this.ensureUnlocked()
    this.updateActivity()

    const now = Date.now()
    const container: Container = {
      id: this.generateId(),
      type,
      name,
      favorite,
      created_at: now,
      updated_at: now,
    }

    this.db!.run(
      'INSERT INTO containers (id, type, name, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [container.id, container.type, container.name, container.favorite ? 1 : 0, container.created_at, container.updated_at]
    )

    this.saveDB()

    console.log('[VAULT] Created container:', container.id)
    return container
  }

  /**
   * Update a container
   */
  updateContainer(id: string, updates: Partial<Pick<Container, 'name' | 'favorite'>>): Container {
    this.ensureUnlocked()
    this.updateActivity()

    const existing = this.getContainerById(id)
    if (!existing) {
      throw new Error('Container not found')
    }

    const updated: Container = {
      ...existing,
      ...updates,
      updated_at: Date.now(),
    }

    this.db!.run(
      'UPDATE containers SET name = ?, favorite = ?, updated_at = ? WHERE id = ?',
      [updated.name, updated.favorite ? 1 : 0, updated.updated_at, id]
    )

    this.saveDB()

    console.log('[VAULT] Updated container:', id)
    return updated
  }

  /**
   * Delete a container (cascades to items)
   */
  deleteContainer(id: string): void {
    this.ensureUnlocked()
    this.updateActivity()

    // Delete associated items first
    this.db!.run('DELETE FROM vault_items WHERE container_id = ?', [id])

    // Delete container
    this.db!.run('DELETE FROM containers WHERE id = ?', [id])

    this.saveDB()

    console.log('[VAULT] Deleted container:', id)
  }

  /**
   * List all containers
   */
  listContainers(): Container[] {
    this.ensureUnlocked()
    this.updateActivity()

    const rows = this.db!.exec('SELECT * FROM containers ORDER BY name ASC')

    if (!rows.length || !rows[0].values.length) {
      return []
    }

    return rows[0].values.map((row: any) => ({
      id: row[0],
      type: row[1],
      name: row[2],
      favorite: row[3] === 1,
      created_at: row[4],
      updated_at: row[5],
    }))
  }

  /**
   * Get container by ID
   */
  private getContainerById(id: string): Container | null {
    const rows = this.db!.exec('SELECT * FROM containers WHERE id = ?', [id])

    if (!rows.length || !rows[0].values.length) {
      return null
    }

    const row = rows[0].values[0]
    return {
      id: row[0],
      type: row[1],
      name: row[2],
      favorite: row[3] === 1,
      created_at: row[4],
      updated_at: row[5],
    }
  }

  // ==========================================================================
  // Item Operations
  // ==========================================================================

  /**
   * Create a vault item
   */
  createItem(item: Omit<VaultItem, 'id' | 'created_at' | 'updated_at'>): VaultItem {
    this.ensureUnlocked()
    this.updateActivity()

    const now = Date.now()
    const newItem: VaultItem = {
      ...item,
      id: this.generateId(),
      created_at: now,
      updated_at: now,
    }

    // Encrypt sensitive fields
    const encryptedFields = this.encryptItemFields(newItem.id, newItem.fields)

    this.db!.run(
      'INSERT INTO vault_items (id, container_id, category, title, domain, fields_json, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newItem.id,
        newItem.container_id || null,
        newItem.category,
        newItem.title,
        newItem.domain || null,
        JSON.stringify(encryptedFields),
        newItem.favorite ? 1 : 0,
        newItem.created_at,
        newItem.updated_at,
      ]
    )

    this.saveDB()

    console.log('[VAULT] Created item:', newItem.id)
    return newItem
  }

  /**
   * Update a vault item
   */
  updateItem(id: string, updates: Partial<Pick<VaultItem, 'title' | 'fields' | 'domain' | 'favorite'>>): VaultItem {
    this.ensureUnlocked()
    this.updateActivity()

    const existing = this.getItemById(id)
    if (!existing) {
      throw new Error('Item not found')
    }

    const updated: VaultItem = {
      ...existing,
      ...updates,
      updated_at: Date.now(),
    }

    // Encrypt sensitive fields if provided
    const fieldsToSave = updates.fields ? this.encryptItemFields(id, updates.fields) : existing.fields

    this.db!.run(
      'UPDATE vault_items SET title = ?, domain = ?, fields_json = ?, favorite = ?, updated_at = ? WHERE id = ?',
      [
        updated.title,
        updated.domain || null,
        JSON.stringify(fieldsToSave),
        updated.favorite ? 1 : 0,
        updated.updated_at,
        id,
      ]
    )

    this.saveDB()

    console.log('[VAULT] Updated item:', id)
    return updated
  }

  /**
   * Delete a vault item
   */
  deleteItem(id: string): void {
    this.ensureUnlocked()
    this.updateActivity()

    this.db!.run('DELETE FROM vault_items WHERE id = ?', [id])

    this.saveDB()

    console.log('[VAULT] Deleted item:', id)
  }

  /**
   * Get a single item (decrypts fields)
   */
  getItem(id: string): VaultItem {
    this.ensureUnlocked()
    this.updateActivity()

    const item = this.getItemById(id)
    if (!item) {
      throw new Error('Item not found')
    }

    // Decrypt fields
    item.fields = this.decryptItemFields(id, item.fields)

    return item
  }

  /**
   * List items with optional filters
   */
  listItems(filters?: {
    container_id?: string
    category?: VaultItem['category']
    favorites_only?: boolean
    limit?: number
    offset?: number
  }): VaultItem[] {
    this.ensureUnlocked()
    this.updateActivity()

    let query = 'SELECT * FROM vault_items WHERE 1=1'
    const params: any[] = []

    if (filters?.container_id) {
      query += ' AND container_id = ?'
      params.push(filters.container_id)
    }

    if (filters?.category) {
      query += ' AND category = ?'
      params.push(filters.category)
    }

    if (filters?.favorites_only) {
      query += ' AND favorite = 1'
    }

    query += ' ORDER BY title ASC'

    if (filters?.limit) {
      query += ' LIMIT ?'
      params.push(filters.limit)
    }

    if (filters?.offset) {
      query += ' OFFSET ?'
      params.push(filters.offset)
    }

    const rows = this.db!.exec(query, params)

    if (!rows.length || !rows[0].values.length) {
      return []
    }

    return rows[0].values.map((row: any) => {
      const item: VaultItem = {
        id: row[0],
        container_id: row[1] || undefined,
        category: row[2],
        title: row[3],
        domain: row[4] || undefined,
        fields: JSON.parse(row[5]),
        favorite: row[6] === 1,
        created_at: row[7],
        updated_at: row[8],
      }

      // Don't decrypt fields in list view for performance
      return item
    })
  }

  /**
   * Search items by title or domain
   */
  search(query: string, category?: VaultItem['category']): VaultItem[] {
    this.ensureUnlocked()
    this.updateActivity()

    const searchTerm = `%${query.toLowerCase()}%`
    let sql = 'SELECT * FROM vault_items WHERE (LOWER(title) LIKE ? OR LOWER(domain) LIKE ?)'
    const params: any[] = [searchTerm, searchTerm]

    if (category) {
      sql += ' AND category = ?'
      params.push(category)
    }

    sql += ' ORDER BY title ASC'

    const rows = this.db!.exec(sql, params)

    if (!rows.length || !rows[0].values.length) {
      return []
    }

    return rows[0].values.map((row: any) => ({
      id: row[0],
      container_id: row[1] || undefined,
      category: row[2],
      title: row[3],
      domain: row[4] || undefined,
      fields: JSON.parse(row[5]),
      favorite: row[6] === 1,
      created_at: row[7],
      updated_at: row[8],
    }))
  }

  /**
   * Get autofill candidates for a domain
   */
  getAutofillCandidates(domain: string): VaultItem[] {
    this.ensureUnlocked()
    this.updateActivity()

    // Normalize domain (remove www., protocol, etc.)
    const normalized = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0]

    const rows = this.db!.exec(
      'SELECT * FROM vault_items WHERE category = ? AND domain LIKE ? ORDER BY title ASC',
      ['password', `%${normalized}%`]
    )

    if (!rows.length || !rows[0].values.length) {
      return []
    }

    return rows[0].values.map((row: any) => {
      const item: VaultItem = {
        id: row[0],
        container_id: row[1] || undefined,
        category: row[2],
        title: row[3],
        domain: row[4] || undefined,
        fields: JSON.parse(row[5]),
        favorite: row[6] === 1,
        created_at: row[7],
        updated_at: row[8],
      }

      // Decrypt fields for autofill
      item.fields = this.decryptItemFields(item.id, item.fields)

      return item
    })
  }

  /**
   * Get item by ID (internal, doesn't decrypt)
   */
  private getItemById(id: string): VaultItem | null {
    const rows = this.db!.exec('SELECT * FROM vault_items WHERE id = ?', [id])

    if (!rows.length || !rows[0].values.length) {
      return null
    }

    const row = rows[0].values[0]
    return {
      id: row[0],
      container_id: row[1] || undefined,
      category: row[2],
      title: row[3],
      domain: row[4] || undefined,
      fields: JSON.parse(row[5]),
      favorite: row[6] === 1,
      created_at: row[7],
      updated_at: row[8],
    }
  }

  // ==========================================================================
  // Settings
  // ==========================================================================

  /**
   * Update vault settings
   */
  updateSettings(updates: Partial<VaultSettings>): VaultSettings {
    this.ensureUnlocked()
    this.updateActivity()

    this.settings = { ...this.settings, ...updates }
    this.saveSettings()

    // Restart autolock timer with new timeout
    if (updates.autoLockMinutes !== undefined) {
      this.startAutoLockTimer()
    }

    console.log('[VAULT] Updated settings:', this.settings)
    return this.settings
  }

  /**
   * Get current settings
   */
  getSettings(): VaultSettings {
    this.ensureUnlocked()
    return { ...this.settings }
  }

  // ==========================================================================
  // CSV Export/Import
  // ==========================================================================

  /**
   * Export vault data to CSV
   */
  exportCSV(): string {
    this.ensureUnlocked()
    this.updateActivity()

    const containers = this.listContainers()
    const items = this.listItems()

    // Build CSV header
    let csv = 'Type,Container,Title,Domain,Category'

    // Find all unique field keys
    const fieldKeys = new Set<string>()
    items.forEach((item) => {
      item.fields.forEach((field) => fieldKeys.add(field.key))
    })

    fieldKeys.forEach((key) => csv += `,${key}`)
    csv += '\n'

    // Add items
    items.forEach((item) => {
      const container = item.container_id
        ? containers.find((c) => c.id === item.container_id)?.name || ''
        : ''

      const decryptedItem = this.getItem(item.id)

      let row = `"${item.category}","${container}","${item.title}","${item.domain || ''}","${item.category}"`

      fieldKeys.forEach((key) => {
        const field = decryptedItem.fields.find((f) => f.key === key)
        const value = field ? field.value.replace(/"/g, '""') : ''
        row += `,"${value}"`
      })

      csv += row + '\n'
    })

    console.log('[VAULT] Exported CSV')
    return csv
  }

  /**
   * Import vault data from CSV
   * Note: This is a basic implementation, production should have better validation
   */
  importCSV(csvData: string): void {
    this.ensureUnlocked()
    this.updateActivity()

    const lines = csvData.split('\n').filter((l) => l.trim())
    if (lines.length < 2) {
      throw new Error('Invalid CSV format')
    }

    const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim())

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.replace(/^"|"$/g, '').trim())

      const category = values[headers.indexOf('Category')] as VaultItem['category']
      const containerName = values[headers.indexOf('Container')]
      const title = values[headers.indexOf('Title')]
      const domain = values[headers.indexOf('Domain')]

      // Find or create container
      let container_id: string | undefined
      if (containerName) {
        const existing = this.listContainers().find((c) => c.name === containerName)
        if (existing) {
          container_id = existing.id
        } else {
          const newContainer = this.createContainer('company', containerName)
          container_id = newContainer.id
        }
      }

      // Build fields
      const fields: Field[] = []
      headers.forEach((header, idx) => {
        if (!['Type', 'Container', 'Title', 'Domain', 'Category'].includes(header) && values[idx]) {
          fields.push({
            key: header,
            value: values[idx],
            encrypted: header === 'password' || header === 'card_number' || header === 'cvv',
            type: header === 'password' ? 'password' : 'text',
          })
        }
      })

      this.createItem({
        container_id,
        category,
        title,
        domain,
        fields,
        favorite: false,
      })
    }

    console.log('[VAULT] Imported CSV data')
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Ensure vault is unlocked
   */
  private ensureUnlocked(): void {
    if (!this.session || !this.db) {
      throw new Error('Vault is locked')
    }
  }

  /**
   * Update last activity timestamp
   */
  private updateActivity(): void {
    if (this.session) {
      this.session.lastActivity = Date.now()
      this.startAutoLockTimer() // Reset timer
    }
  }

  /**
   * Start or restart autolock timer
   */
  private startAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer)
    }

    if (this.settings.autoLockMinutes === 0) {
      // Never lock
      return
    }

    const timeoutMs = this.settings.autoLockMinutes * 60 * 1000

    this.autoLockTimer = setTimeout(() => {
      console.log('[VAULT] Autolock timeout reached')
      this.lock()
    }, timeoutMs)
  }

  /**
   * Generate random ID
   */
  private generateId(): string {
    return randomBytes(16).toString('hex')
  }

  /**
   * Generate capability token
   */
  private generateToken(): string {
    return randomBytes(32).toString('hex')
  }

  /**
   * Save database to disk
   */
  private saveDB(): void {
    if (this.db && this.session?.vmk) {
      saveVaultDB(this.db, this.session.vmk)
    }
  }

  /**
   * Encrypt item fields (only encrypt fields marked as encrypted)
   */
  private encryptItemFields(itemId: string, fields: Field[]): Field[] {
    return fields.map((field) => {
      if (field.encrypted && this.session?.vmk) {
        const fieldKey = deriveFieldKey(this.session.vmk, 'field-encryption', itemId)
        return {
          ...field,
          value: encryptField(field.value, fieldKey),
        }
      }
      return field
    })
  }

  /**
   * Decrypt item fields
   */
  private decryptItemFields(itemId: string, fields: Field[]): Field[] {
    return fields.map((field) => {
      if (field.encrypted && this.session?.vmk) {
        try {
          const fieldKey = deriveFieldKey(this.session.vmk, 'field-encryption', itemId)
          return {
            ...field,
            value: decryptField(field.value, fieldKey),
          }
        } catch (error) {
          console.error('[VAULT] Failed to decrypt field:', error)
          return { ...field, value: '[DECRYPTION FAILED]' }
        }
      }
      return field
    })
  }

  /**
   * Load vault metadata from database (raw, without DEK)
   */
  private loadVaultMetaRaw(): {
    salt: Buffer
    wrappedDEK: Buffer
    kdfParams: KDFParams
  } {
    const metaPath = getVaultMetaPath()
    const metaData = JSON.parse(readFileSync(metaPath, 'utf-8'))

    return {
      salt: Buffer.from(metaData.salt, 'base64'),
      wrappedDEK: Buffer.from(metaData.wrappedDEK, 'base64'),
      kdfParams: metaData.kdfParams,
    }
  }

  /**
   * Save vault metadata
   */
  private saveVaultMeta(salt: Buffer, wrappedDEK: Buffer, kdfParams: KDFParams): void {
    const metaPath = getVaultMetaPath()

    const metaData = {
      salt: salt.toString('base64'),
      wrappedDEK: wrappedDEK.toString('base64'),
      kdfParams,
    }

    writeFileSync(metaPath, JSON.stringify(metaData, null, 2))

    // Also store in database for redundancy
    const now = Date.now()

    this.db!.run(
      'INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES (?, ?, ?)',
      ['salt', salt, now]
    )

    this.db!.run(
      'INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES (?, ?, ?)',
      ['wrapped_dek', wrappedDEK, now]
    )

    this.db!.run(
      'INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES (?, ?, ?)',
      ['kdf_params', Buffer.from(JSON.stringify(kdfParams)), now]
    )
  }

  /**
   * Load settings from database
   */
  private loadSettings(): void {
    try {
      const rows = this.db!.exec('SELECT value FROM vault_meta WHERE key = ?', ['settings'])

      if (rows.length && rows[0].values.length) {
        const settingsData = rows[0].values[0][0]
        this.settings = JSON.parse(Buffer.from(settingsData).toString('utf-8'))
      }
    } catch (error) {
      // Use defaults if not found
      console.log('[VAULT] Using default settings')
    }
  }

  /**
   * Save settings to database
   */
  private saveSettings(): void {
    const now = Date.now()
    this.db!.run(
      'INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES (?, ?, ?)',
      ['settings', Buffer.from(JSON.stringify(this.settings)), now]
    )
    this.saveDB()
  }

  /**
   * Clean up old unlock attempts (older than 1 minute)
   */
  private cleanupUnlockAttempts(): void {
    const oneMinuteAgo = Date.now() - 60000
    this.unlockAttempts = this.unlockAttempts.filter((ts) => ts > oneMinuteAgo)
  }

  /**
   * Validate extension token
   */
  validateToken(token: string): boolean {
    return !!this.session && this.session.extensionToken === token
  }
}

// Singleton instance
export const vaultService = new VaultService()

