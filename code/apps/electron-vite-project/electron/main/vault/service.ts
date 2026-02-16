/**
 * Vault Service - Core business logic for password manager
 * Handles unlock, lock, CRUD operations, session management, and autolock
 */

import { randomBytes } from 'crypto'
import type { Container, VaultItem, VaultSession, VaultStatus, VaultSettings, Field, ItemCategory } from './types'
import {
  canAccessCategory,
  canAttachContext,
  LEGACY_CATEGORY_TO_RECORD_TYPE,
  type VaultTier,
  type HandshakeBindingPolicy,
  type HandshakeTarget,
  type AttachEvalResult,
} from './types'
import {
  generateRandomKey,
  wrapDEK,
  zeroize,
  deriveFieldKey,
  decryptField,
  DEFAULT_KDF_PARAMS,
  type KDFParams,
} from './crypto'
import type { UnlockProvider, ProviderState, UnlockProviderType } from './unlockProvider'
import { resolveProvider, derivePasskeyWrappingKey } from './unlockProvider'
import {
  sealRecord,
  openRecord,
  ENVELOPE_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
} from './envelope'
import { DecryptCache } from './cache'
import {
  importDocument,
  getDocument,
  listDocuments,
  deleteDocument,
  updateDocumentMeta,
} from './documentService'
import type { VaultDocument, DocumentImportResult } from './types'
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
import { readFileSync, unlinkSync, existsSync as fsExistsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

import { atomicWriteFileSync } from './atomicWrite'
import { ChallengeStore } from './challengeStore'

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
  
  // Connection state tracking
  private dbValid: boolean = false // Track if database connection is valid

  // Server-side challenge store for passkey flows (TTL 5 min, one-time use)
  private challengeStore = new ChallengeStore({ ttlMs: 300_000, maxPending: 32 })

  // Per-record decrypt cache (TTL=60s, max 16 entries, flushed on lock)
  private decryptCache = new DecryptCache({ ttlMs: 60_000, maxEntries: 16 })

  // Unlock provider abstraction
  private provider: UnlockProvider | null = null
  private providerStates: ProviderState[] = []
  private activeProviderType: UnlockProviderType = 'passphrase'

  constructor() {
    console.log('[VAULT] VaultService initialized')
    console.log('[VAULT] Vault path:', getVaultPath())
  }

  // ==========================================================================
  // Vault Creation & Unlock
  // ==========================================================================

  /**
   * Create a new vault with master password.
   *
   * @param masterPassword  Passphrase for the default provider
   * @param vaultName       Display name
   * @param vaultId         Optional explicit ID
   * @param providerType    Provider type to enroll (default: 'passphrase')
   */
  async createVault(
    masterPassword: string,
    vaultName: string,
    vaultId?: string,
    providerType: UnlockProviderType = 'passphrase',
  ): Promise<string> {
    // Generate unique vault ID if not provided
    if (!vaultId) {
      vaultId = `vault_${Date.now()}_${randomBytes(4).toString('hex')}`
    }

    // Check if vault already exists
    if (vaultExists(vaultId)) {
      throw new Error(`Vault with ID "${vaultId}" already exists`)
    }

    console.log('[VAULT] Creating new vault:', vaultId, vaultName, 'provider:', providerType)

    // Generate DEK (the provider will generate its own salt and wrap the DEK)
    const dek = generateRandomKey()

    // Resolve and enroll the provider
    const provider = resolveProvider(providerType)
    const enrollment = await provider.enroll(masterPassword, dek, DEFAULT_KDF_PARAMS)

    const { salt, wrappedDEK, kek, providerState } = enrollment

    // Store provider references
    this.provider = provider
    this.providerStates = [providerState]
    this.activeProviderType = providerType

    // Create database
    this.db = await createVaultDB(dek, vaultId)
    this.dbValid = true
    this.currentVaultId = vaultId

    // Store vault metadata (now includes provider info)
    this.saveVaultMeta(salt, wrappedDEK, DEFAULT_KDF_PARAMS, vaultId)

    // Register vault in registry
    registerVault(vaultId, vaultName)

    // Store settings
    this.saveSettings()

    // Create session (KEK + DEK both in memory while unlocked)
    this.session = {
      vmk: dek,
      kek,
      extensionToken: this.generateToken(),
      lastActivity: Date.now(),
      providerType,
    }

    this.startAutoLockTimer()

    console.log('[VAULT] ✅ Vault created successfully:', vaultId, 'via', providerType)
    return vaultId
  }

  /**
   * Unlock existing vault with master password.
   *
   * @param masterPassword  Passphrase credential (for the passphrase provider)
   * @param vaultId         Which vault to unlock
   * @param providerType    Which provider to use (defaults to the vault's active provider)
   */
  async unlock(
    masterPassword: string,
    vaultId: string = 'default',
    providerType?: UnlockProviderType,
  ): Promise<string> {
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
    const rawMeta = this.loadVaultMetaRaw(vaultId)

    // Determine which provider to use
    const effectiveProviderType = providerType || rawMeta.activeProviderType || 'passphrase'
    const provider = resolveProvider(effectiveProviderType)

    // Find the provider-specific state (if any)
    const providerState = rawMeta.providerStates?.find(
      ps => ps.type === effectiveProviderType,
    )

    // Delegate unlock to the provider
    const { kek, dek } = await provider.unlock(masterPassword, {
      salt: rawMeta.salt,
      wrappedDEK: rawMeta.wrappedDEK,
      kdfParams: rawMeta.kdfParams,
      providerState,
    })

    // Store provider references
    this.provider = provider
    this.providerStates = rawMeta.providerStates || []
    this.activeProviderType = effectiveProviderType

    // Open database
    try {
      this.db = await openVaultDB(dek, vaultId)
      this.dbValid = true
    } catch (error) {
      zeroize(dek)
      zeroize(kek)
      provider.lock()
      this.dbValid = false
      throw new Error('Failed to open vault database')
    }

    // Load settings
    this.loadSettings()

    // Create session (KEK + DEK both in memory while unlocked)
    this.session = {
      vmk: dek,
      kek,
      extensionToken: this.generateToken(),
      lastActivity: Date.now(),
      providerType: effectiveProviderType,
    }

    this.startAutoLockTimer()

    console.log('[VAULT] ✅ Vault unlocked successfully via', effectiveProviderType)
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

    // Flush decrypt cache FIRST (before losing keys)
    this.decryptCache.flush()

    // Close database
    if (this.db) {
      closeVaultDB(this.db)
      this.db = null
    }

    // Zeroize DEK and KEK
    if (this.session.vmk) {
      zeroize(this.session.vmk)
    }
    if (this.session.kek) {
      zeroize(this.session.kek)
    }

    // Tell the provider to clear its own in-memory material
    if (this.provider) {
      this.provider.lock()
      this.provider = null
    }

    // Clear session
    this.session = null
    this.dbValid = false

    // Stop autolock timer
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer)
      this.autoLockTimer = null
    }

    console.log('[VAULT] ✅ Vault locked')
  }

  // ==========================================================================
  // Passkey (WebAuthn) Enrollment & Unlock
  // ==========================================================================

  /** Transient state for an in-progress passkey enrollment ceremony. */
  private passkeyEnrollPrfSalt: Buffer | null = null
  private passkeyEnrollChallenge: Buffer | null = null

  /**
   * Begin passkey enrollment — returns challenge + PRF salt for the WebAuthn ceremony.
   * The vault must already be unlocked (KEK in memory).
   * Requires Pro+ tier.
   */
  beginPasskeyEnroll(tier: string): { challenge: string; prfSalt: string } {
    this.ensureUnlocked()
    this.requireProTier(tier)

    this.passkeyEnrollChallenge = randomBytes(32)
    this.passkeyEnrollPrfSalt = randomBytes(32)

    const challengeB64 = this.passkeyEnrollChallenge.toString('base64')
    this.challengeStore.issue(challengeB64)

    console.log('[VAULT] Passkey enrollment begun — waiting for WebAuthn ceremony')
    return {
      challenge: challengeB64,
      prfSalt: this.passkeyEnrollPrfSalt.toString('base64'),
    }
  }

  /**
   * Complete passkey enrollment — wraps the in-memory KEK with the PRF-derived key.
   *
   * @param tier             User tier (must be Pro+)
   * @param credentialId     Base64url-encoded credential ID from WebAuthn create()
   * @param prfOutputBase64  Base64-encoded PRF evaluation result from the authenticator
   * @param rpId             RP ID used in the ceremony (stored for assertion)
   * @param challengeBase64  The challenge returned by beginPasskeyEnroll (server-verified)
   */
  async completePasskeyEnroll(
    tier: string,
    credentialId: string,
    prfOutputBase64: string,
    rpId: string,
    challengeBase64: string,
  ): Promise<void> {
    this.ensureUnlocked()
    this.requireProTier(tier)

    // Verify server-issued challenge (one-time use, TTL-bounded)
    if (!challengeBase64 || !this.challengeStore.consume(challengeBase64)) {
      this.passkeyEnrollChallenge = null
      this.passkeyEnrollPrfSalt = null
      throw new Error('Invalid or expired enrollment challenge')
    }

    if (!this.passkeyEnrollPrfSalt) {
      throw new Error('No active passkey enrollment — call beginPasskeyEnroll first')
    }

    const kek = this.session!.kek
    if (!kek) {
      throw new Error('KEK not available in session')
    }

    const prfOutput = Buffer.from(prfOutputBase64, 'base64')
    const prfSalt = this.passkeyEnrollPrfSalt

    // Derive wrapping key from PRF output via HKDF
    const wrappingKey = derivePasskeyWrappingKey(prfOutput, prfSalt)

    // Wrap KEK with the passkey wrapping key (reuse AES-256-GCM wrapDEK)
    const wrappedKEK = await wrapDEK(kek, wrappingKey)

    zeroize(wrappingKey)
    zeroize(prfOutput)

    // Build provider state
    const providerState: ProviderState = {
      type: 'passkey',
      name: 'Passkey (WebAuthn)',
      enrolled_at: Date.now(),
      data: {
        credentialId,
        prfSalt: prfSalt.toString('base64'),
        wrappedKEK: wrappedKEK.toString('base64'),
        rpId,
      },
    }

    // Replace any existing passkey provider state
    this.providerStates = this.providerStates.filter(ps => ps.type !== 'passkey')
    this.providerStates.push(providerState)

    // Persist updated provider list
    this.updateProvidersMeta(this.currentVaultId)

    // Clear enrollment transient state
    this.passkeyEnrollChallenge = null
    this.passkeyEnrollPrfSalt = null

    console.log('[VAULT] ✅ Passkey enrolled successfully')
  }

  /**
   * Remove enrolled passkey provider.  Vault must be unlocked, tier must be Pro+.
   */
  removePasskeyProvider(tier: string): void {
    this.ensureUnlocked()
    this.requireProTier(tier)

    const hadPasskey = this.providerStates.some(ps => ps.type === 'passkey')
    if (!hadPasskey) {
      throw new Error('No passkey provider enrolled')
    }

    this.providerStates = this.providerStates.filter(ps => ps.type !== 'passkey')
    if (this.activeProviderType === 'passkey') {
      this.activeProviderType = 'passphrase'
    }
    this.updateProvidersMeta(this.currentVaultId)

    console.log('[VAULT] ✅ Passkey provider removed')
  }

  /**
   * Begin passkey unlock — returns stored credential ID, PRF salt, and a fresh challenge.
   * Called when the vault is locked (reads unencrypted meta file).
   */
  beginPasskeyUnlock(vaultId: string = 'default'): {
    challenge: string
    credentialId: string
    prfSalt: string
    rpId: string
  } {
    const rawMeta = this.loadVaultMetaRaw(vaultId)
    const passkeyState = rawMeta.providerStates.find(ps => ps.type === 'passkey')
    if (!passkeyState) {
      throw new Error('No passkey provider enrolled for this vault')
    }

    const challengeB64 = randomBytes(32).toString('base64')
    this.challengeStore.issue(challengeB64)

    return {
      challenge: challengeB64,
      credentialId: passkeyState.data.credentialId,
      prfSalt: passkeyState.data.prfSalt,
      rpId: passkeyState.data.rpId || '',
    }
  }

  /**
   * Complete passkey unlock — unwraps KEK using PRF output, then opens the vault.
   *
   * @param tier              User tier (must be Pro+)
   * @param prfOutputBase64   Base64-encoded PRF evaluation result
   * @param challengeBase64   The challenge returned by beginPasskeyUnlock (server-verified)
   * @param vaultId           Which vault to unlock
   * @returns Extension token for the new session
   */
  async completePasskeyUnlock(
    tier: string,
    prfOutputBase64: string,
    challengeBase64: string,
    vaultId: string = 'default',
  ): Promise<string> {
    // Verify server-issued challenge (one-time use, TTL-bounded)
    if (!challengeBase64 || !this.challengeStore.consume(challengeBase64)) {
      throw new Error('Invalid or expired unlock challenge')
    }

    if (!vaultExists(vaultId)) {
      throw new Error(`Vault does not exist: ${vaultId}`)
    }

    this.currentVaultId = vaultId
    this.requireProTier(tier)

    if (this.session) {
      throw new Error('Vault is already unlocked')
    }

    // Rate limiting (same as passphrase)
    this.cleanupUnlockAttempts()
    if (this.unlockAttempts.length >= 5) {
      throw new Error('Too many unlock attempts. Please wait a minute.')
    }
    this.unlockAttempts.push(Date.now())

    console.log('[VAULT] Unlocking vault via passkey...')

    const rawMeta = this.loadVaultMetaRaw(vaultId)

    // Resolve passkey provider and find its state
    const provider = resolveProvider('passkey')
    const passkeyState = rawMeta.providerStates.find(ps => ps.type === 'passkey')
    if (!passkeyState) {
      throw new Error('No passkey provider enrolled for this vault')
    }

    const prfOutput = Buffer.from(prfOutputBase64, 'base64')

    // Delegate to PasskeyUnlockProvider.unlock()
    const { kek, dek } = await provider.unlock(
      { prfOutput },
      {
        salt: rawMeta.salt,
        wrappedDEK: rawMeta.wrappedDEK,
        kdfParams: rawMeta.kdfParams,
        providerState: passkeyState,
      },
    )

    zeroize(prfOutput)

    // Store provider references
    this.provider = provider
    this.providerStates = rawMeta.providerStates || []
    this.activeProviderType = 'passkey'

    // Open database
    try {
      this.db = await openVaultDB(dek, vaultId)
      this.dbValid = true
    } catch (error) {
      zeroize(dek)
      zeroize(kek)
      provider.lock()
      this.dbValid = false
      throw new Error('Failed to open vault database')
    }

    // Load settings
    this.loadSettings()

    // Create session
    this.session = {
      vmk: dek,
      kek,
      extensionToken: this.generateToken(),
      lastActivity: Date.now(),
      providerType: 'passkey',
    }

    this.startAutoLockTimer()

    console.log('[VAULT] ✅ Vault unlocked successfully via passkey')
    return this.session.extensionToken
  }

  // -- Passkey helpers -------------------------------------------------------

  /** Throw if tier is below Pro. */
  private requireProTier(tier: string): void {
    const TIER_LEVEL: Record<string, number> = {
      free: 0, private: 1, private_lifetime: 2,
      pro: 3, publisher: 4, publisher_lifetime: 5, enterprise: 6,
    }
    if ((TIER_LEVEL[tier] ?? 0) < (TIER_LEVEL['pro'] ?? 3)) {
      throw new Error('Passkey requires Pro+ tier')
    }
  }

  /**
   * Update only the provider fields in the vault meta file
   * (avoids re-serializing salt/wrappedDEK/kdfParams).
   */
  private updateProvidersMeta(vaultId: string = 'default'): void {
    const metaPath = getVaultMetaPath(vaultId)
    if (!fsExistsSync(metaPath)) {
      throw new Error('Vault meta file not found')
    }
    const metaData = JSON.parse(readFileSync(metaPath, 'utf-8'))
    metaData.unlockProviders = this.providerStates
    metaData.activeProviderType = this.activeProviderType
    atomicWriteFileSync(metaPath, JSON.stringify(metaData, null, 2))
    console.log('[VAULT] Updated provider metadata in:', metaPath)
  }

  /**
   * Get vault status
   */
  getStatus(vaultId?: string): VaultStatus {
    const targetVaultId = vaultId || this.currentVaultId
    const exists = vaultExists(targetVaultId)
    const isCurrentVault = targetVaultId === this.currentVaultId

    // Determine available providers for this vault
    let unlockProviders: Array<{ id: string; name: string }> = []
    let activeProviderType: string = 'passphrase'

    if (exists) {
      try {
        const rawMeta = this.loadVaultMetaRaw(targetVaultId)
        activeProviderType = rawMeta.activeProviderType || 'passphrase'
        // List providers that have enrolled state
        if (rawMeta.providerStates && rawMeta.providerStates.length > 0) {
          unlockProviders = rawMeta.providerStates.map(ps => ({
            id: ps.type,
            name: ps.name,
          }))
        } else {
          // Legacy vault — only passphrase
          unlockProviders = [{ id: 'passphrase', name: 'Master Password' }]
        }
      } catch {
        // Meta read failed; fall back to passphrase-only
        unlockProviders = [{ id: 'passphrase', name: 'Master Password' }]
      }
    }

    return {
      exists,
      locked: !isCurrentVault || !this.session,
      isUnlocked: isCurrentVault && !!this.session,
      autoLockMinutes: this.settings.autoLockMinutes,
      currentVaultId: this.currentVaultId,
      availableVaults: this.getAvailableVaults(),
      unlockProviders,
      activeProviderType,
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

    // CRITICAL FIX: .all() is broken, use .get() workaround
    let rows: any[] = []
    
    try {
      console.log('[VAULT] Querying containers using .get() workaround...')
      
      // Get count first
      const countStmt = this.db!.prepare('SELECT COUNT(*) as count FROM containers')
      const countResult = countStmt.get() as any
      const totalRows = countResult?.count || 0
      
      if (totalRows === 0) {
        console.log('[VAULT] No containers found')
        return []
      }
      
      // Fetch rows one by one using LIMIT/OFFSET
      let offset = 0
      while (rows.length < totalRows) {
        const fetchQuery = `SELECT * FROM containers ORDER BY name ASC LIMIT 1 OFFSET ${offset}`
        const fetchStmt = this.db!.prepare(fetchQuery)
        const row = fetchStmt.get()
        
        if (row && typeof row === 'object' && Object.keys(row).length > 0) {
          rows.push(row)
          offset++
        } else {
          break
        }
      }
      
      console.log(`[VAULT] ✅ Found ${rows.length} containers using .get() workaround`)
    } catch (error: any) {
      console.error('[VAULT] Container query failed:', error?.message)
      return []
    }

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
  async createItem(item: Omit<VaultItem, 'id' | 'created_at' | 'updated_at'>, tier: VaultTier): Promise<VaultItem> {
    this.ensureUnlocked()
    this.updateActivity()

    // ── Capability check BEFORE any encryption/storage (defense-in-depth) ──
    if (!canAccessCategory(tier, item.category as any, 'write')) {
      throw new Error(`Tier "${tier}" cannot write category "${item.category}"`)
    }
    
    // Ensure database connection is valid before INSERT
    const connectionValid = await this.ensureDbConnection()
    if (!connectionValid) {
      throw new Error('Database connection is invalid')
    }

    const now = Date.now()
    const newItem: VaultItem = {
      ...item,
      id: this.generateId(),
      created_at: now,
      updated_at: now,
    }

    // ── Envelope encryption (schema_version = 2) ──
    // Serialize fields, seal with a per-record DEK wrapped by the KEK.
    const fieldsJson = JSON.stringify(newItem.fields)
    const { wrappedDEK: wrappedRecordDEK, ciphertext } = await sealRecord(fieldsJson, this.session!.kek)

    // Determine record_type from category (for capability gating)
    const recordType = LEGACY_CATEGORY_TO_RECORD_TYPE[newItem.category as keyof typeof LEGACY_CATEGORY_TO_RECORD_TYPE] || 'custom'

    console.log('[VAULT] Sealed item with envelope encryption:', newItem.id, 'schema_version=2')

    try {
      console.log('[VAULT] 📝 Starting INSERT (envelope v2) for item:', {
        id: newItem.id,
        category: newItem.category,
        record_type: recordType,
        title: newItem.title,
      })

      this.db!.exec('BEGIN IMMEDIATE')
      try {
        const stmt = this.db!.prepare(
          `INSERT INTO vault_items
           (id, container_id, category, title, domain, fields_json,
            favorite, created_at, updated_at,
            wrapped_dek, ciphertext, record_type, schema_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )

        stmt.run(
          newItem.id,
          newItem.container_id || null,
          newItem.category,
          newItem.title,
          newItem.domain || null,
          '[]',                         // fields_json = empty (data lives in ciphertext)
          newItem.favorite ? 1 : 0,
          newItem.created_at,
          newItem.updated_at,
          wrappedRecordDEK,             // BLOB
          ciphertext,                   // BLOB
          recordType,
          ENVELOPE_SCHEMA_VERSION,      // 2
        )

        this.db!.exec('COMMIT')
        console.log('[VAULT] ✅ Envelope INSERT committed')

        try {
          this.db!.prepare('PRAGMA wal_checkpoint(PASSIVE)').run()
        } catch (cpError: any) {
          // non-critical
        }
      } catch (txError: any) {
        this.db!.exec('ROLLBACK')
        console.error('[VAULT] ❌ Transaction failed, rolled back:', txError?.message)
        throw txError
      }
    } catch (error: any) {
      console.error('[VAULT] ❌ INSERT failed for item:', newItem.id, error)
      throw new Error(`Failed to save item: ${error?.message || error}`)
    }

    console.log('[VAULT] ✅ Created item successfully:', newItem.id, 'category:', newItem.category, 'title:', newItem.title)
    return newItem
  }

  /**
   * Update a vault item
   */
  async updateItem(id: string, updates: Partial<Pick<VaultItem, 'title' | 'fields' | 'domain' | 'favorite'>>, tier: VaultTier): Promise<VaultItem> {
    this.ensureUnlocked()
    this.updateActivity()

    // ── Capability check BEFORE any decrypt/re-encrypt ──
    const itemCategory = this.getItemCategory(id)
    if (!canAccessCategory(tier, itemCategory as any, 'write')) {
      throw new Error(`Tier "${tier}" cannot write category "${itemCategory}"`)
    }

    const row = this.getItemRowById(id)
    if (!row) {
      throw new Error('Item not found')
    }

    const existing = this.rowToItem(row)
    const updated: VaultItem = {
      ...existing,
      ...updates,
      updated_at: Date.now(),
    }

    // Invalidate cache for this item
    this.decryptCache.evict(id)

    if (updates.fields) {
      // ── Re-seal with fresh per-record DEK (always writes as v2) ──
      const fieldsJson = JSON.stringify(updates.fields)
      const { wrappedDEK, ciphertext } = await sealRecord(fieldsJson, this.session!.kek)
      const recordType = LEGACY_CATEGORY_TO_RECORD_TYPE[updated.category as keyof typeof LEGACY_CATEGORY_TO_RECORD_TYPE] || 'custom'

      this.db!.prepare(
        `UPDATE vault_items
         SET title = ?, domain = ?, fields_json = ?, favorite = ?, updated_at = ?,
             wrapped_dek = ?, ciphertext = ?, record_type = ?, schema_version = ?
         WHERE id = ?`
      ).run(
        updated.title,
        updated.domain || null,
        '[]',
        updated.favorite ? 1 : 0,
        updated.updated_at,
        wrappedDEK,
        ciphertext,
        recordType,
        ENVELOPE_SCHEMA_VERSION,
        id,
      )
    } else {
      // Metadata-only update (title, domain, favorite) — no re-encryption needed
      this.db!.prepare(
        'UPDATE vault_items SET title = ?, domain = ?, favorite = ?, updated_at = ? WHERE id = ?'
      ).run(
        updated.title,
        updated.domain || null,
        updated.favorite ? 1 : 0,
        updated.updated_at,
        id,
      )
    }

    console.log('[VAULT] Updated item:', id, `(schema_version=${updates.fields ? ENVELOPE_SCHEMA_VERSION : 'unchanged'})`)
    return updated
  }

  /**
   * Delete a vault item
   */
  deleteItem(id: string, tier: VaultTier): void {
    this.ensureUnlocked()
    this.updateActivity()

    // ── Capability check BEFORE any mutation ──
    const itemCategory = this.getItemCategory(id)
    if (!canAccessCategory(tier, itemCategory as any, 'delete')) {
      throw new Error(`Tier "${tier}" cannot delete category "${itemCategory}"`)
    }

    this.decryptCache.evict(id)
    this.db!.prepare('DELETE FROM vault_items WHERE id = ?').run(id)

    console.log('[VAULT] Deleted item:', id)
  }

  /**
   * Get a single item (decrypts fields lazily, per-record).
   * For envelope v2 records: unwraps per-record DEK, decrypts ciphertext.
   * For legacy v1 records: uses HKDF field-level decryption.
   *
   * @param tier  REQUIRED — capability check is performed BEFORE any
   *              cryptographic unwrap (fail-closed).
   */
  async getItem(id: string, tier: VaultTier): Promise<VaultItem> {
    this.ensureUnlocked()
    this.updateActivity()

    const row = this.getItemRowById(id)
    if (!row) {
      throw new Error('Item not found')
    }

    const schemaVersion: number = (row as any).schema_version ?? LEGACY_SCHEMA_VERSION

    // ── Capability check BEFORE any decrypt / unwrap (always enforced) ──
    const cat = row.category as ItemCategory
    if (!canAccessCategory(tier, cat as any, 'read')) {
      throw new Error(`Tier "${tier}" cannot read category "${cat}"`)
    }

    // ── Check decrypt cache ──
    const cached = this.decryptCache.get(id)
    if (cached) {
      const item = this.rowToItem(row)
      item.fields = JSON.parse(cached)
      return item
    }

    // ── Decrypt based on schema version ──
    const item = this.rowToItem(row)

    if (schemaVersion >= ENVELOPE_SCHEMA_VERSION && (row as any).wrapped_dek && (row as any).ciphertext) {
      // Envelope v2: unwrap per-record DEK, decrypt ciphertext
      const wrappedDEK = Buffer.from((row as any).wrapped_dek)
      const ciphertext = Buffer.from((row as any).ciphertext)
      item.fields = await openRecord(wrappedDEK, ciphertext, this.session!.kek)
    } else {
      // Legacy v1: HKDF field-level decryption
      item.fields = await this.decryptItemFields(id, item.fields)
    }

    // Cache the decrypted fields
    this.decryptCache.set(id, JSON.stringify(item.fields))

    return item
  }

  /**
   * List items with optional filters.
   *
   * Returns METADATA ONLY for ALL schema versions — `fields` is always
   * an empty array.  The caller must use `getItem(id)` to decrypt a
   * single record on demand (lazy decrypt invariant).
   *
   * Legacy v1 records are queued for opportunistic migration to v2
   * (fire-and-forget) so that future reads are envelope-encrypted.
   */
  async listItems(filters?: {
    container_id?: string
    category?: VaultItem['category']
    favorites_only?: boolean
    limit?: number
    offset?: number
  }, tier?: VaultTier): Promise<VaultItem[]> {
    this.ensureUnlocked()
    this.updateActivity()

    console.log('[VAULT] 📋 listItems called with filters:', filters)

    let query = 'SELECT id, container_id, category, title, domain, favorite, created_at, updated_at, schema_version FROM vault_items WHERE 1=1'
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

    let rows: any[] = []
    try {
      const connectionValid = await this.ensureDbConnection()
      if (!connectionValid) {
        console.error('[VAULT] Database connection invalid')
        return []
      }

      try {
        this.db.prepare('PRAGMA wal_checkpoint(PASSIVE)').run()
      } catch { /* non-critical */ }

      const stmt = this.db.prepare(query)
      rows = params.length > 0 ? stmt.all(...params) : stmt.all()
      console.log(`[VAULT] ✅ Query returned ${rows.length} rows`)

      if (!Array.isArray(rows) || rows.length === 0) return []
    } catch (error: any) {
      console.error('[VAULT] Database query failed:', error?.message)
      return []
    }

    // Map rows → VaultItem.  ALL records return fields=[] (no decrypt).
    const items: VaultItem[] = []
    const v1Ids: string[] = []

    for (const row of rows) {
      const sv: number = row.schema_version ?? LEGACY_SCHEMA_VERSION

      if (sv < ENVELOPE_SCHEMA_VERSION) {
        v1Ids.push(row.id)
      }

      // Metadata only — no decryption for any schema version
      items.push({
        id: row.id,
        container_id: row.container_id || undefined,
        category: row.category,
        title: row.title,
        domain: row.domain || undefined,
        fields: [],   // caller must use getItem(id) for decrypted data
        favorite: row.favorite === 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })
    }

    // Opportunistic v1→v2 migration (fire-and-forget, non-blocking)
    if (v1Ids.length > 0) {
      console.log(`[VAULT] 🔄 ${v1Ids.length} legacy v1 record(s) detected — queuing migration`)
      Promise.all(v1Ids.map(id => this.migrateItemToV2(id).catch(err => {
        console.error(`[VAULT] Migration failed for ${id}:`, err?.message)
      })))
    }

    // If tier is provided, filter items by capability (defense-in-depth)
    const filtered = tier
      ? items.filter(i => canAccessCategory(tier, i.category as any, 'read'))
      : items

    console.log(`[VAULT] Listed ${filtered.length} items (category: ${filters?.category || 'all'}, v1_pending: ${v1Ids.length}, tier_filtered: ${tier ? 'yes' : 'no'})`)
    return filtered
  }

  /**
   * Search items by title or domain.
   *
   * Returns METADATA ONLY — `fields` is always an empty array.
   * Caller must use `getItem(id)` to decrypt individual results.
   */
  search(query: string, category?: VaultItem['category'], tier?: VaultTier): VaultItem[] {
    this.ensureUnlocked()
    this.updateActivity()

    const searchTerm = `%${query.toLowerCase()}%`
    let sql = 'SELECT id, container_id, category, title, domain, favorite, created_at, updated_at FROM vault_items WHERE (LOWER(title) LIKE ? OR LOWER(domain) LIKE ?)'
    const params: any[] = [searchTerm, searchTerm]

    if (category) {
      sql += ' AND category = ?'
      params.push(category)
    }

    sql += ' ORDER BY title ASC'

    const rows = this.db!.prepare(sql).all(...params) as any[]

    const items = rows.map((row: any) => ({
      id: row.id,
      container_id: row.container_id || undefined,
      category: row.category,
      title: row.title,
      domain: row.domain || undefined,
      fields: [] as Field[],   // metadata only — use getItem(id) for decrypted fields
      favorite: row.favorite === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))

    // If tier provided, filter by capability
    return tier
      ? items.filter(i => canAccessCategory(tier, i.category as any, 'read'))
      : items
  }

  /**
   * Get autofill candidates for a domain (capability-gated).
   * Uses getItem() per record to respect envelope encryption and capability checks.
   */
  async getAutofillCandidates(domain: string, tier: VaultTier): Promise<VaultItem[]> {
    this.ensureUnlocked()
    this.updateActivity()

    // ── Capability check: password category requires Pro+ ──
    if (!canAccessCategory(tier, 'password' as any, 'read')) {
      return []
    }

    // Normalize domain (remove www., protocol, etc.)
    const normalized = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0]

    const rows = this.db!.prepare(
      'SELECT id FROM vault_items WHERE category = ? AND domain LIKE ? ORDER BY title ASC'
    ).all('password', `%${normalized}%`) as any[]

    // Decrypt each record individually via getItem (respects envelope v2 + capability)
    const items: VaultItem[] = []
    for (const row of rows) {
      try {
        items.push(await this.getItem(row.id, tier))
      } catch {
        // Skip records that fail capability/decrypt
      }
    }
    return items
  }

  /**
   * Get raw database row by ID (no parsing, no decrypt).
   * Returns the row as-is from better-sqlite3, including envelope columns.
   */
  private getItemRowById(id: string): any | null {
    const row = this.db!.prepare('SELECT * FROM vault_items WHERE id = ?').get(id) as any
    return row || null
  }

  /**
   * Return the category of a vault item WITHOUT decrypting any fields.
   * Used by mutation routes (update/delete/meta-set) that need to gate on
   * category but never need plaintext.
   */
  getItemCategory(id: string): string {
    this.ensureUnlocked()
    const row = this.db!.prepare('SELECT category FROM vault_items WHERE id = ?').get(id) as any
    if (!row) throw new Error('Item not found')
    return row.category as string
  }

  /**
   * Convert a raw DB row → VaultItem (parses fields_json, no decryption).
   */
  private rowToItem(row: any): VaultItem {
    let fields: Field[] = []
    try {
      const parsed = row.fields_json ? JSON.parse(row.fields_json) : []
      fields = Array.isArray(parsed) ? parsed.filter((f: any) => f && typeof f === 'object') : []
    } catch {
      fields = []
    }
    return {
      id: row.id,
      container_id: row.container_id || undefined,
      category: row.category,
      title: row.title,
      domain: row.domain || undefined,
      fields,
      favorite: row.favorite === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  // getItemById removed — use getItemRowById() + rowToItem() instead.

  // ==========================================================================
  // Legacy → Envelope Migration
  // ==========================================================================

  /**
   * Migrate a single legacy (v1) record to envelope (v2) format.
   * Called opportunistically on read or explicitly via upgradeVault().
   *
   * 1. Decrypt fields using legacy HKDF approach.
   * 2. Re-encrypt using per-record DEK (envelope).
   * 3. Update the row in-place.
   */
  async migrateItemToV2(id: string): Promise<void> {
    this.ensureUnlocked()

    const row = this.getItemRowById(id)
    if (!row) return
    if ((row.schema_version ?? LEGACY_SCHEMA_VERSION) >= ENVELOPE_SCHEMA_VERSION) return

    // Decrypt with legacy approach
    let fields: Field[] = []
    try {
      const parsed = row.fields_json ? JSON.parse(row.fields_json) : []
      fields = Array.isArray(parsed) ? parsed : []
    } catch { return }

    const decryptedFields = await this.decryptItemFields(id, fields)

    // Re-seal with envelope encryption
    const fieldsJson = JSON.stringify(decryptedFields)
    const { wrappedDEK, ciphertext } = await sealRecord(fieldsJson, this.session!.kek)
    const recordType = LEGACY_CATEGORY_TO_RECORD_TYPE[row.category as keyof typeof LEGACY_CATEGORY_TO_RECORD_TYPE] || 'custom'

    this.db!.prepare(
      `UPDATE vault_items
       SET fields_json = '[]', wrapped_dek = ?, ciphertext = ?,
           record_type = ?, schema_version = ?, updated_at = ?
       WHERE id = ?`
    ).run(wrappedDEK, ciphertext, recordType, ENVELOPE_SCHEMA_VERSION, Date.now(), id)

    console.log(`[VAULT] ✅ Migrated item ${id} from v1 → v2 (envelope)`)
  }

  /**
   * Bulk-upgrade all legacy v1 records to envelope v2.
   * Optional — can be triggered by a UI button or admin command.
   * Returns the number of records migrated.
   */
  async upgradeVault(): Promise<number> {
    this.ensureUnlocked()

    const legacyRows = this.db!.prepare(
      'SELECT id FROM vault_items WHERE schema_version IS NULL OR schema_version < ?'
    ).all(ENVELOPE_SCHEMA_VERSION) as any[]

    if (!Array.isArray(legacyRows) || legacyRows.length === 0) {
      console.log('[VAULT] No legacy records to migrate')
      return 0
    }

    console.log(`[VAULT] Upgrading ${legacyRows.length} legacy record(s) to envelope v2...`)

    let migrated = 0
    for (const row of legacyRows) {
      try {
        await this.migrateItemToV2(row.id)
        migrated++
      } catch (err: any) {
        console.error(`[VAULT] Failed to migrate item ${row.id}:`, err?.message)
      }
    }

    console.log(`[VAULT] ✅ Vault upgrade complete: ${migrated}/${legacyRows.length} records migrated`)
    return migrated
  }

  // ==========================================================================
  // Document Vault Operations
  // ==========================================================================

  /**
   * Import a document into the encrypted vault.
   * Delegates to documentService with capability check.
   */
  async importDocument(
    tier: VaultTier,
    filename: string,
    data: Buffer,
    notes?: string,
  ): Promise<DocumentImportResult> {
    this.ensureUnlocked()
    this.updateActivity()
    return importDocument(this.db!, this.session!.kek, tier, filename, data, notes)
  }

  /**
   * Retrieve and decrypt a stored document.
   */
  async getDocument(
    tier: VaultTier,
    documentId: string,
  ): Promise<{ document: VaultDocument; content: Buffer }> {
    this.ensureUnlocked()
    this.updateActivity()
    return getDocument(this.db!, this.session!.kek, tier, documentId)
  }

  /**
   * List all documents (metadata only — no decryption).
   */
  listDocuments(tier: VaultTier): VaultDocument[] {
    this.ensureUnlocked()
    this.updateActivity()
    return listDocuments(this.db!, tier)
  }

  /**
   * Delete a document from the vault.
   */
  deleteDocument(tier: VaultTier, documentId: string): void {
    this.ensureUnlocked()
    this.updateActivity()
    deleteDocument(this.db!, tier, documentId)
  }

  /**
   * Update document metadata (notes/tags).
   */
  updateDocumentMeta(
    tier: VaultTier,
    documentId: string,
    updates: { notes?: string },
  ): VaultDocument {
    this.ensureUnlocked()
    this.updateActivity()
    return updateDocumentMeta(this.db!, tier, documentId, updates)
  }

  // ==========================================================================
  // Item Metadata (meta column) — used by Handshake Context
  // ==========================================================================

  /**
   * Read the `meta` JSON column for a vault item.
   * Returns `null` if the item has no meta or the column is empty.
   */
  getItemMeta(id: string, tier: VaultTier): any | null {
    this.ensureUnlocked()

    // ── Capability check BEFORE reading metadata ──
    const itemCategory = this.getItemCategory(id)
    if (!canAccessCategory(tier, itemCategory as any, 'read')) {
      throw new Error(`Tier "${tier}" cannot read category "${itemCategory}"`)
    }

    const row = this.db!.prepare('SELECT meta FROM vault_items WHERE id = ?').get(id) as any
    if (!row || !row.meta) return null
    try { return JSON.parse(row.meta) } catch { return null }
  }

  /**
   * Write the `meta` JSON column for a vault item.
   * Merges with existing meta (shallow).
   */
  setItemMeta(id: string, meta: Record<string, any>, tier: VaultTier): void {
    this.ensureUnlocked()
    this.updateActivity()

    // Capability check is enforced inside getItemMeta (reads category)
    const existing = this.getItemMeta(id, tier) || {}
    const merged = { ...existing, ...meta }
    const now = Date.now()

    this.db!.prepare(
      'UPDATE vault_items SET meta = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(merged), now, id)

    console.log(`[VAULT] Updated meta for item ${id}`)
  }

  // ==========================================================================
  // Handshake Context — Binding Policy Evaluation
  // ==========================================================================

  /**
   * Evaluate whether a handshake context item can be attached to a handshake.
   * Reads the binding policy from the item's meta column, then delegates
   * to the pure `canAttachContext` function.
   *
   * @param tier      - User's resolved tier
   * @param itemId    - The handshake_context vault item ID
   * @param target    - The handshake requesting the context
   */
  async evaluateAttach(
    tier: VaultTier,
    itemId: string,
    target: HandshakeTarget,
  ): Promise<AttachEvalResult> {
    this.ensureUnlocked()

    // Read the binding policy from meta (capability check inside getItemMeta)
    const meta = this.getItemMeta(itemId, tier)
    const policy: HandshakeBindingPolicy = meta?.binding_policy || {
      allowed_domains: [],
      handshake_types: [],
      valid_until: null,
      safe_to_share: false,
      step_up_required: false,
    }

    return canAttachContext(tier, policy, target)
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
   * Export vault data to CSV (capability-gated per record).
   */
  async exportCSV(tier: VaultTier): Promise<string> {
    this.ensureUnlocked()
    this.updateActivity()

    const containers = this.listContainers()
    let items = await this.listItems()

    // Filter items by capability — only export what this tier can read
    items = items.filter(i => canAccessCategory(tier, i.category as any, 'read'))

    // Build CSV header
    let csv = 'Type,Container,Title,Domain,Category'

    // Decrypt accessible items to discover field keys
    const decryptedItems: VaultItem[] = []
    for (const item of items) {
      try {
        decryptedItems.push(await this.getItem(item.id, tier))
      } catch {
        // Skip items that fail capability/decrypt (fail-closed)
      }
    }

    const fieldKeys = new Set<string>()
    decryptedItems.forEach((item: VaultItem) => {
      item.fields.forEach((field: any) => fieldKeys.add(field.key))
    })

    fieldKeys.forEach((key) => csv += `,${key}`)
    csv += '\n'

    // Format rows
    const rows = decryptedItems.map((decryptedItem: VaultItem) => {
      const container = decryptedItem.container_id
        ? containers.find((c) => c.id === decryptedItem.container_id)?.name || ''
        : ''

      let row = `"${decryptedItem.category}","${container}","${decryptedItem.title}","${decryptedItem.domain || ''}","${decryptedItem.category}"`

      fieldKeys.forEach((key) => {
        const field = decryptedItem.fields.find((f: Field) => f.key === key)
        const value = field ? field.value.replace(/"/g, '""') : ''
        row += `,"${value}"`
      })

      return row
    })

    csv += rows.join('\n') + '\n'

    console.log(`[VAULT] Exported CSV (${decryptedItems.length} items for tier=${tier})`)
    return csv
  }

  /**
   * Import vault data from CSV (capability-gated per row).
   */
  importCSV(csvData: string, tier: VaultTier): void {
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
      }, tier)
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
   * Ensure database connection is valid and recover if needed
   * This checks if the connection is still working and attempts to recover if broken
   */
  private async ensureDbConnection(): Promise<boolean> {
    if (!this.db || !this.session) {
      console.error('[VAULT] Database or session is null')
      return false
    }

    // If we think connection is valid, test it quickly
    if (this.dbValid) {
      try {
        const testStmt = this.db.prepare('SELECT 1 as test')
        const testResult = testStmt.get()
        if (testResult && (testResult as any).test === 1) {
          return true // Connection is valid
        }
      } catch (error: any) {
        console.warn('[VAULT] Connection test failed, marking as invalid:', error?.code, error?.message)
        this.dbValid = false
      }
    }

    // Connection is invalid or test failed - try to recover
    if (!this.dbValid && this.session) {
      console.log('[VAULT] Attempting to recover database connection...')
      try {
        // Try to reopen the database with the same DEK
        const { openVaultDB } = await import('./db')
        const dek = this.session.vmk
        this.db = await openVaultDB(dek, this.currentVaultId)
        this.dbValid = true
        console.log('[VAULT] ✅ Database connection recovered')
        return true
      } catch (error: any) {
        console.error('[VAULT] ❌ Failed to recover database connection:', error?.message)
        this.dbValid = false
        return false
      }
    }

    return this.dbValid
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

  // encryptItemFields removed — envelope v2 uses sealRecord() instead.
  // The legacy HKDF encrypt path is no longer needed (writes are always v2).

  /**
   * Decrypt item fields (legacy v1 HKDF path — used for migration & backwards compat)
   */
  private async decryptItemFields(itemId: string, fields: Field[]): Promise<Field[]> {
    // Ensure fields is an array
    if (!Array.isArray(fields)) {
      console.error('[VAULT] decryptItemFields: fields is not an array:', typeof fields, fields)
      return []
    }
    
    // Handle empty fields array
    if (fields.length === 0) {
      return []
    }
    
    // Ensure all fields are valid before mapping
    const validFields = fields.filter(f => f && typeof f === 'object')
    if (validFields.length !== fields.length) {
      console.warn('[VAULT] Some fields were invalid and filtered out')
    }
    
    const decryptedFields = await Promise.all(validFields.map(async (field) => {
      // Ensure field is an object
      if (!field || typeof field !== 'object') {
        console.error('[VAULT] decryptItemFields: field is not an object:', typeof field, field)
        return { key: 'unknown', value: '', encrypted: false, type: 'text' } as Field
      }
      
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
    providerStates: ProviderState[]
    activeProviderType: UnlockProviderType
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
          // Additive: existing meta files without provider fields default gracefully
          providerStates: metaData.unlockProviders || [],
          activeProviderType: (metaData.activeProviderType || 'passphrase') as UnlockProviderType,
        }
      } catch (error) {
        console.warn('[VAULT] Failed to read metadata file, will try database:', error)
      }
    }
    
    // File doesn't exist - this is a critical error
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

    const metaData: Record<string, any> = {
      salt: salt.toString('base64'),
      wrappedDEK: wrappedDEK.toString('base64'),
      kdfParams,
      // Provider metadata (additive — old code simply ignores these fields)
      unlockProviders: this.providerStates,
      activeProviderType: this.activeProviderType,
    }

    // Ensure directory exists
    try {
      mkdirSync(dirname(metaPath), { recursive: true })
    } catch (error) {
      // Directory might already exist, ignore
    }

    try {
      atomicWriteFileSync(metaPath, JSON.stringify(metaData, null, 2))
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

  /**
   * Get the Vault Session Binding Token (VSBT) for the current session.
   * Returns null when the vault is locked.
   *
   * SECURITY: The returned value must NEVER be logged or persisted to disk.
   */
  getSessionToken(): string | null {
    return this.session?.extensionToken ?? null
  }
}

// Singleton instance
export const vaultService = new VaultService()

