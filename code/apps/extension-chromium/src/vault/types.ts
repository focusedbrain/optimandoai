/**
 * Type definitions for vault entities (shared with Electron)
 */

export type ContainerType = 'person' | 'company' | 'business'
export type ItemCategory = 'password' | 'identity' | 'company' | 'business'
export type FieldType = 'text' | 'password' | 'email' | 'url' | 'number' | 'textarea'

// Standard field definitions for each category
export interface StandardFieldDef {
  key: string
  label: string
  type: FieldType
  required: boolean
  explanation: string // For AI autofill context
}

// Standard fields for Identity (Private Data)
export const IDENTITY_STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'name', label: 'Full Name', type: 'text', required: true, explanation: 'Full legal name of the person' },
  { key: 'address', label: 'Address', type: 'textarea', required: false, explanation: 'Complete street address including city, state, and postal code' },
  { key: 'email', label: 'Email', type: 'email', required: false, explanation: 'Primary email address' },
  { key: 'phone', label: 'Phone Number', type: 'text', required: false, explanation: 'Primary phone number with country code' },
  { key: 'tax_id', label: 'Tax ID / SSN', type: 'text', required: false, explanation: 'Tax identification number or social security number' },
]

// Standard fields for Company
export const COMPANY_STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'company_name', label: 'Company Name', type: 'text', required: true, explanation: 'Legal company name' },
  { key: 'address', label: 'Company Address', type: 'textarea', required: false, explanation: 'Registered business address' },
  { key: 'email', label: 'Company Email', type: 'email', required: false, explanation: 'Primary business email address' },
  { key: 'phone', label: 'Phone Number', type: 'text', required: false, explanation: 'Business phone number' },
  { key: 'vat_number', label: 'VAT Number', type: 'text', required: false, explanation: 'Value Added Tax identification number' },
  { key: 'tax_id', label: 'Tax ID', type: 'text', required: false, explanation: 'Business tax identification number' },
]

// Standard fields for Business (same as Company)
export const BUSINESS_STANDARD_FIELDS: StandardFieldDef[] = COMPANY_STANDARD_FIELDS.map(f => ({
  ...f,
  explanation: f.explanation.replace('Company', 'Business').replace('company', 'business')
}))

// Standard fields for Password entries
export const PASSWORD_STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'username', label: 'Username / Email', type: 'text', required: false, explanation: 'Login username or email address' },
  { key: 'password', label: 'Password', type: 'password', required: true, explanation: 'Account password' },
  { key: 'url', label: 'Website URL', type: 'url', required: false, explanation: 'Website URL for autofill matching' },
  { key: 'notes', label: 'Notes', type: 'textarea', required: false, explanation: 'Additional notes or security questions' },
]

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
  explanation?: string // Optional explanation for AI autofill context
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
  isUnlocked?: boolean
  currentVaultId?: string
  availableVaults?: Array<{ id: string, name: string, created: number }>
}

// Category tree structure
export interface CategoryNode {
  id: string
  label: string
  icon: string
  type: 'main' | 'subcategory'
  parentId?: string
  category?: ItemCategory
  containerType?: ContainerType
  expanded?: boolean
}

export interface VaultSettings {
  autoLockMinutes: number
}
