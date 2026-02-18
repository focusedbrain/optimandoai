/**
 * Type definitions for vault entities
 */

// Re-export capability types and helpers for backend access checks
export type {
  VaultRecordType,
  VaultTier,
  VaultAction,
  LegacyItemCategory,
  HandshakeBindingPolicy,
  HandshakeTarget,
  AttachBlockReason,
  AttachEvalResult,
} from './capabilities'
export {
  VAULT_RECORD_TYPES,
  TIER_LEVEL,
  RECORD_TYPE_MIN_TIER,
  DEFAULT_BINDING_POLICY,
  canAccessRecordType,
  getAccessibleRecordTypes,
  canAccessCategory,
  canAttachContext,
  matchDomainGlob,
  LEGACY_CATEGORY_TO_RECORD_TYPE,
  ALL_ITEM_CATEGORIES,
} from './capabilities'

/**
 * Container types for organizational grouping
 */
export type ContainerType = 'person' | 'company'

/**
 * Item categories
 */
export type ItemCategory = 'automation_secret' | 'password' | 'identity' | 'company' | 'custom' | 'document' | 'handshake_context'

/**
 * Field types for dynamic form rendering
 */
export type FieldType = 'text' | 'password' | 'email' | 'url' | 'number' | 'textarea'

/**
 * Container (Company or Identity)
 */
export interface Container {
  id: string
  type: ContainerType
  name: string
  favorite: boolean
  created_at: number
  updated_at: number
}

/**
 * Field within a vault item
 */
export interface Field {
  key: string          // e.g., 'username', 'password', 'street'
  value: string        // plain or encrypted JSON string
  encrypted: boolean   // true for passwords, card numbers, etc.
  type: FieldType      // for UI rendering
  explanation?: string // Optional explanation for AI autofill context
}

/**
 * Vault item (password, address, payment, etc.)
 */
export interface VaultItem {
  id: string
  container_id?: string  // null for standalone items
  category: ItemCategory
  title: string
  fields: Field[]
  domain?: string        // for password items (autofill matching)
  favorite: boolean
  created_at: number
  updated_at: number
}

/**
 * Vault session (active when unlocked)
 */
export interface VaultSession {
  vmk: Buffer              // Vault Master Key (DEK) — used for SQLCipher + legacy HKDF
  kek: Buffer              // Key Encryption Key — wraps/unwraps per-record DEKs (envelope v2)
  extensionToken: Buffer   // Capability token for extension access (raw 32 bytes, hex-encoded only for transport)
  lastActivity: number     // Timestamp for autolock
  /** The unlock provider type used for this session (default: 'passphrase'). */
  providerType?: string
}

/**
 * Vault status
 */
export interface VaultStatus {
  exists: boolean
  locked: boolean
  isUnlocked?: boolean
  autoLockMinutes: number
  currentVaultId?: string
  availableVaults?: Array<{ id: string, name: string, created: number }>
  /** User's resolved subscription tier (injected by the API route layer). */
  tier?: string
  /** Available unlock provider types for the current vault. */
  unlockProviders?: Array<{ id: string; name: string }>
  /** The active (default) provider type for the current vault. */
  activeProviderType?: string
}

/**
 * Vault settings
 */
export interface VaultSettings {
  autoLockMinutes: number  // 15, 30, 1440 (1 day), or 0 (never)

  /**
   * Global toggle: enables/disables all Secure Insert Overlay features.
   * When OFF, no field scanning, overlay, or commit-insert runs.
   * Default: true (ON).
   */
  autofillEnabled: boolean

  /**
   * Per-section toggles for autofill.
   * Each section can be independently enabled/disabled.
   * Only effective when autofillEnabled is true.
   * Default: all true (ON).
   */
  autofillSections: {
    login: boolean     // username/email/password
    identity: boolean  // name/address/phone/etc.
    company: boolean   // company/vat/etc.
    custom: boolean    // tagged custom fields
  }
}

/**
 * KDF parameters stored in vault metadata
 */
export interface KDFParams {
  memoryCost: number
  timeCost: number
  parallelism: number
}

/**
 * CSV export row format
 */
export interface CSVRow {
  Type: string
  Container: string
  Title: string
  Domain: string
  [key: string]: string  // Dynamic field columns
}

// ---------------------------------------------------------------------------
// Document Vault Types
// ---------------------------------------------------------------------------

/** Maximum document size in bytes (50 MB). */
export const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024

/**
 * MIME types considered safe for optional in-UI preview.
 * Everything else is treated as opaque binary (download-only).
 * CRITICAL: No executable MIME types are ever allowed here.
 */
export const SAFE_PREVIEW_MIMES = new Set([
  'text/plain',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

/**
 * File extensions that are ALWAYS blocked from import.
 * These are executable / scripting vectors that must never enter the vault.
 */
export const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  '.sh', '.bash', '.zsh', '.ps1', '.psm1',
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.py', '.pyc', '.pyo', '.rb', '.pl', '.php',
  '.jar', '.class', '.war', '.ear',
  '.app', '.action', '.command', '.workflow',
  '.vbs', '.vbe', '.wsf', '.wsh', '.hta',
  '.lnk', '.inf', '.reg', '.cpl',
])

/**
 * Metadata for a stored document (kept in the vault_documents table).
 */
export interface VaultDocument {
  id: string
  /** Original filename (sanitised — no path separators). */
  filename: string
  /** Detected MIME type (for display, never for execution). */
  mime_type: string
  /** Original plaintext size in bytes. */
  size_bytes: number
  /** SHA-256 hex digest of original plaintext content (content addressing). */
  sha256: string
  /** Notes or tags (user-supplied, optional). */
  notes: string
  created_at: number
  updated_at: number
}

/**
 * Result of importing a document into the vault.
 */
export interface DocumentImportResult {
  document: VaultDocument
  /** Whether a document with the same SHA-256 already existed. */
  deduplicated: boolean
}
