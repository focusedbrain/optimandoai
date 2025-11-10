/**
 * Type definitions for vault entities
 */

/**
 * Container types for organizational grouping
 */
export type ContainerType = 'company' | 'identity'

/**
 * Item categories
 */
export type ItemCategory = 'password' | 'address' | 'payment' | 'tax_id' | 'notice'

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
  vmk: Buffer              // Vault Master Key (DEK)
  extensionToken: string   // Capability token for extension access
  lastActivity: number     // Timestamp for autolock
}

/**
 * Vault status
 */
export interface VaultStatus {
  exists: boolean
  locked: boolean
  autoLockMinutes: number
}

/**
 * Vault settings
 */
export interface VaultSettings {
  autoLockMinutes: number  // 15, 30, 1440 (1 day), or 0 (never)
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
