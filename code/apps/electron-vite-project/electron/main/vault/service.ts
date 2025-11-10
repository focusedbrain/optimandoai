/**
 * Vault Service - Core business logic for password manager
 * Handles unlock, lock, CRUD operations, session management, and autolock
 */

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
  closeVaultDB,
  vaultExists,
  getVaultPath,
  getVaultMetaPath,
  listVaults,
  registerVault,
  unregisterVault,
} from './db'
import { readFileSync, writeFileSync, unlinkSync, existsSync as fsExistsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export class VaultService {
  private db: any | null = null
  private session: VaultSession | null = null
  private currentVaultId: string = 'default' // Currently active vault
  private autoLockTimer: NodeJS.Timeout | null = null
  private settings: VaultSettings = {
    autoLockMinutes: 30, // Default: 30 minutes
  }
  
  // Rate limiting
  private unlockAttempts: number[] = [] // Timestamps

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
  async createVault(masterPassword: string, vaultName: string, vaultId?: string): Promise<string> {
    // Generate unique vault ID if not provided
    if (!vaultId) {
      vaultId = `vault_${Date.now()}_${randomBytes(4).toString('hex')}`
    }

    // Check if vault already exists
    if (vaultExists(vaultId)) {
      throw new Error(`Vault with ID "${vaultId}" already exists`)
    }

    console.log('[VAULT] Creating new vault:', vaultId, vaultName)

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
    this.db = await createVaultDB(dek, vaultId)
    this.currentVaultId = vaultId

    // Store vault metadata
    this.saveVaultMeta(salt, wrappedDEK, DEFAULT_KDF_PARAMS, vaultId)

    // Register vault in registry
    registerVault(vaultId, vaultName)

    // Store settings
    this.saveSettings()

    // Create session
    this.session = {
      vmk: dek,
      extensionToken: this.generateToken(),
      lastActivity: Date.now(),
    }

    this.startAutoLockTimer()

    console.log('[VAULT] ✅ Vault created successfully:', vaultId)
    return vaultId
  }

  /**
   * Unlock existing vault with master password
   */
  async unlock(masterPassword: string, vaultId: string = 'default'): Promise<string> {
    if (!vaultExists(vaultId)) {
      throw new Error(`Vault does not exist: ${vaultId}`)
    }

    this.currentVaultId = vaultId

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
    const { salt, wrappedDEK, kdfParams } = this.loadVaultMetaRaw(vaultId)

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
      this.db = await openVaultDB(dek, vaultId)
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
   * Delete vault (remove database and metadata files)
   * Can only delete when vault is unlocked (for security)
   */
  async deleteVault(vaultId?: string): Promise<void> {
    // Use current vault if not specified
    const targetVaultId = vaultId || this.currentVaultId

    // Must be unlocked to delete (security measure)
    if (!this.session || this.currentVaultId !== targetVaultId) {
      throw new Error('Vault must be unlocked to delete it')
    }

    console.log('[VAULT] Deleting vault:', targetVaultId)

    const vaultPath = getVaultPath(targetVaultId)
    const metaPath = getVaultMetaPath(targetVaultId)

    // Lock vault first
    this.lock()

    try {
      // Delete database file
      if (fsExistsSync(vaultPath)) {
        unlinkSync(vaultPath)
        console.log('[VAULT] Deleted vault database:', vaultPath)
      }

      // Delete metadata file
      if (fsExistsSync(metaPath)) {
        unlinkSync(metaPath)
        console.log('[VAULT] Deleted vault metadata:', metaPath)
      }

      // Unregister from registry
      unregisterVault(targetVaultId)

      console.log('[VAULT] ✅ Vault deleted successfully:', targetVaultId)
    } catch (error: any) {
      console.error('[VAULT] Error deleting vault:', error)
      throw new Error(`Failed to delete vault: ${error.message}`)
    }
  }

  /**
   * List all available vaults
   */
  getAvailableVaults(): Array<{ id: string, name: string, created: number }> {
    return listVaults()
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
  getStatus(vaultId?: string): VaultStatus {
    const targetVaultId = vaultId || this.currentVaultId
    const exists = vaultExists(targetVaultId)
    const isCurrentVault = targetVaultId === this.currentVaultId
    return {
      exists,
      locked: !isCurrentVault || !this.session,
      isUnlocked: isCurrentVault && !!this.session,
      autoLockMinutes: this.settings.autoLockMinutes,
      currentVaultId: this.currentVaultId,
      availableVaults: this.getAvailableVaults(),
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

    this.db!.prepare(
      'INSERT INTO containers (id, type, name, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(container.id, container.type, container.name, container.favorite ? 1 : 0, container.created_at, container.updated_at)

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

    this.db!.prepare(
      'UPDATE containers SET name = ?, favorite = ?, updated_at = ? WHERE id = ?'
    ).run(updated.name, updated.favorite ? 1 : 0, updated.updated_at, id)

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
    this.db!.prepare('DELETE FROM vault_items WHERE container_id = ?').run(id)

    // Delete container
    this.db!.prepare('DELETE FROM containers WHERE id = ?').run(id)

    console.log('[VAULT] Deleted container:', id)
  }

  /**
   * List all containers
   */
  listContainers(): Container[] {
    this.ensureUnlocked()
    this.updateActivity()

    const rows = this.db!.prepare('SELECT * FROM containers ORDER BY name ASC').all() as any[]

    return rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      favorite: row.favorite === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  }

  /**
   * Get container by ID
   */
  private getContainerById(id: string): Container | null {
    const row = this.db!.prepare('SELECT * FROM containers WHERE id = ?').get(id) as any

    if (!row) {
      return null
    }

    return {
      id: row.id,
      type: row.type,
      name: row.name,
      favorite: row.favorite === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  // ==========================================================================
  // Item Operations
  // ==========================================================================

  /**
   * Create a vault item
   */
  async createItem(item: Omit<VaultItem, 'id' | 'created_at' | 'updated_at'>): Promise<VaultItem> {
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
    const encryptedFields = await this.encryptItemFields(newItem.id, newItem.fields)

    this.db!.prepare(
      'INSERT INTO vault_items (id, container_id, category, title, domain, fields_json, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      newItem.id,
      newItem.container_id || null,
      newItem.category,
      newItem.title,
      newItem.domain || null,
      JSON.stringify(encryptedFields),
      newItem.favorite ? 1 : 0,
      newItem.created_at,
      newItem.updated_at
    )

    console.log('[VAULT] Created item:', newItem.id)
    return newItem
  }

  /**
   * Update a vault item
   */
  async updateItem(id: string, updates: Partial<Pick<VaultItem, 'title' | 'fields' | 'domain' | 'favorite'>>): Promise<VaultItem> {
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
    const fieldsToSave = updates.fields ? await this.encryptItemFields(id, updates.fields) : existing.fields

    this.db!.prepare(
      'UPDATE vault_items SET title = ?, domain = ?, fields_json = ?, favorite = ?, updated_at = ? WHERE id = ?'
    ).run(
      updated.title,
      updated.domain || null,
      JSON.stringify(fieldsToSave),
      updated.favorite ? 1 : 0,
      updated.updated_at,
      id
    )

    console.log('[VAULT] Updated item:', id)
    return updated
  }

  /**
   * Delete a vault item
   */
  deleteItem(id: string): void {
    this.ensureUnlocked()
    this.updateActivity()

    this.db!.prepare('DELETE FROM vault_items WHERE id = ?').run(id)

    console.log('[VAULT] Deleted item:', id)
  }

  /**
   * Get a single item (decrypts fields)
   */
  async getItem(id: string): Promise<VaultItem> {
    this.ensureUnlocked()
    this.updateActivity()

    const item = this.getItemById(id)
    if (!item) {
      throw new Error('Item not found')
    }

    // Decrypt fields
    item.fields = await this.decryptItemFields(id, item.fields)

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

    const rows = this.db!.prepare(query).all(...params) as any[]

    return rows.map((row: any) => ({
      id: row.id,
      container_id: row.container_id || undefined,
      category: row.category,
      title: row.title,
      domain: row.domain || undefined,
      fields: JSON.parse(row.fields_json),
      favorite: row.favorite === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
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

    const rows = this.db!.prepare(sql).all(...params) as any[]

    return rows.map((row: any) => ({
      id: row.id,
      container_id: row.container_id || undefined,
      category: row.category,
      title: row.title,
      domain: row.domain || undefined,
      fields: JSON.parse(row.fields_json),
      favorite: row.favorite === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  }

  /**
   * Get autofill candidates for a domain
   */
  async getAutofillCandidates(domain: string): Promise<VaultItem[]> {
    this.ensureUnlocked()
    this.updateActivity()

    // Normalize domain (remove www., protocol, etc.)
    const normalized = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0]

    const rows = this.db!.prepare(
      'SELECT * FROM vault_items WHERE category = ? AND domain LIKE ? ORDER BY title ASC'
    ).all('password', `%${normalized}%`) as any[]

    const items = await Promise.all(rows.map(async (row: any) => {
      const item: VaultItem = {
        id: row.id,
        container_id: row.container_id || undefined,
        category: row.category,
        title: row.title,
        domain: row.domain || undefined,
        fields: JSON.parse(row.fields_json),
        favorite: row.favorite === 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }

      // Decrypt fields for autofill
      item.fields = await this.decryptItemFields(item.id, item.fields)

      return item
    }))
    return items
  }

  /**
   * Get item by ID (internal, doesn't decrypt)
   */
  private getItemById(id: string): VaultItem | null {
    const row = this.db!.prepare('SELECT * FROM vault_items WHERE id = ?').get(id) as any

    if (!row) {
      return null
    }

    return {
      id: row.id,
      container_id: row.container_id || undefined,
      category: row.category,
      title: row.title,
      domain: row.domain || undefined,
      fields: JSON.parse(row.fields_json),
      favorite: row.favorite === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
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
  async exportCSV(): Promise<string> {
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

    // Add items (await all decryptions)
    const rows = await Promise.all(items.map(async (item) => {
      const container = item.container_id
        ? containers.find((c) => c.id === item.container_id)?.name || ''
        : ''

      const decryptedItem = await this.getItem(item.id)

      let row = `"${item.category}","${container}","${item.title}","${item.domain || ''}","${item.category}"`

      fieldKeys.forEach((key) => {
        const field = decryptedItem.fields.find((f: Field) => f.key === key)
        const value = field ? field.value.replace(/"/g, '""') : ''
        row += `,"${value}"`
      })

      return row
    }))

    csv += rows.join('\n') + '\n'

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
   * Encrypt item fields (only encrypt fields marked as encrypted)
   */
  private async encryptItemFields(itemId: string, fields: Field[]): Promise<Field[]> {
    const encryptedFields = await Promise.all(fields.map(async (field) => {
      if (field.encrypted && this.session?.vmk) {
        const fieldKey = deriveFieldKey(this.session.vmk, 'field-encryption', itemId)
        return {
          ...field,
          value: await encryptField(field.value, fieldKey),
        }
      }
      return field
    }))
    return encryptedFields
  }

  /**
   * Decrypt item fields
   */
  private async decryptItemFields(itemId: string, fields: Field[]): Promise<Field[]> {
    const decryptedFields = await Promise.all(fields.map(async (field) => {
      if (field.encrypted && this.session?.vmk) {
        try {
          const fieldKey = deriveFieldKey(this.session.vmk, 'field-encryption', itemId)
          return {
            ...field,
            value: await decryptField(field.value, fieldKey),
          }
        } catch (error) {
          console.error('[VAULT] Failed to decrypt field:', error)
          return { ...field, value: '[DECRYPTION FAILED]' }
        }
      }
      return field
    }))
    return decryptedFields
  }

  /**
   * Load vault metadata from database (raw, without DEK)
   * Falls back to reading from database if file doesn't exist
   */
  private loadVaultMetaRaw(vaultId: string = 'default'): {
    salt: Buffer
    wrappedDEK: Buffer
    kdfParams: KDFParams
  } {
    const metaPath = getVaultMetaPath(vaultId)
    
    // Try to read from file first
    if (fsExistsSync(metaPath)) {
      try {
        const metaData = JSON.parse(readFileSync(metaPath, 'utf-8'))
        return {
          salt: Buffer.from(metaData.salt, 'base64'),
          wrappedDEK: Buffer.from(metaData.wrappedDEK, 'base64'),
          kdfParams: metaData.kdfParams,
        }
      } catch (error) {
        console.warn('[VAULT] Failed to read metadata file, will try database:', error)
      }
    }
    
    // File doesn't exist - this is a critical error
    // We cannot read encrypted metadata from the database without the key,
    // and we need the metadata to derive the key. This is a circular dependency.
    console.error('[VAULT] CRITICAL: Metadata file not found:', metaPath)
    console.error('[VAULT] This vault was created but metadata file was not saved.')
    console.error('[VAULT] The vault database exists but cannot be unlocked without metadata.')
    
    throw new Error('Vault metadata file is missing. The vault was created but the metadata file was not saved properly. Please delete the vault database and create a new vault. Location: ' + metaPath)
  }

  /**
   * Save vault metadata
   */
  private saveVaultMeta(salt: Buffer, wrappedDEK: Buffer, kdfParams: KDFParams, vaultId: string = 'default'): void {
    const metaPath = getVaultMetaPath(vaultId)

    const metaData = {
      salt: salt.toString('base64'),
      wrappedDEK: wrappedDEK.toString('base64'),
      kdfParams,
    }

    // Ensure directory exists
    try {
      mkdirSync(dirname(metaPath), { recursive: true })
    } catch (error) {
      // Directory might already exist, ignore
    }

    try {
      writeFileSync(metaPath, JSON.stringify(metaData, null, 2))
      console.log('[VAULT] Saved vault metadata to:', metaPath)
    } catch (error) {
      console.error('[VAULT] Failed to save metadata file:', error)
      // Continue - metadata is also in database
    }

    // Also store in database for redundancy
    const now = Date.now()

    this.db!.prepare(
      'INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES (?, ?, ?)'
    ).run('salt', salt, now)

    this.db!.prepare(
      'INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES (?, ?, ?)'
    ).run('wrapped_dek', wrappedDEK, now)

    this.db!.prepare(
      'INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES (?, ?, ?)'
    ).run('kdf_params', Buffer.from(JSON.stringify(kdfParams)), now)
  }

  /**
   * Load settings from database
   */
  private loadSettings(): void {
    try {
      const row = this.db!.prepare('SELECT value FROM vault_meta WHERE key = ?').get('settings') as any

      if (row) {
        this.settings = JSON.parse(Buffer.from(row.value).toString('utf-8'))
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
    this.db!.prepare(
      'INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES (?, ?, ?)'
    ).run('settings', Buffer.from(JSON.stringify(this.settings)), now)
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

