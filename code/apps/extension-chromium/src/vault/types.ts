/**
 * Type definitions for vault entities (shared with Electron)
 */

export type ContainerType = 'company' | 'identity'
export type ItemCategory = 'password' | 'address' | 'payment' | 'tax_id' | 'notice'
export type FieldType = 'text' | 'password' | 'email' | 'url' | 'number' | 'textarea'

export interface Container {
  id: string
  type: ContainerType
  name: string
  favorite: boolean
  created_at: number
  updated_at: number
}

export interface Field {
  key: string
  value: string
  encrypted: boolean
  type: FieldType
}

export interface VaultItem {
  id: string
  container_id?: string
  category: ItemCategory
  title: string
  fields: Field[]
  domain?: string
  favorite: boolean
  created_at: number
  updated_at: number
}

export interface VaultStatus {
  exists: boolean
  locked: boolean
  autoLockMinutes: number
}

export interface VaultSettings {
  autoLockMinutes: number
}
