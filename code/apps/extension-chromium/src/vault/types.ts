/**
 * Type definitions for vault entities (shared with Electron)
 */

export type ContainerType = 'person' | 'company' | 'business'
export type ItemCategory = 'password' | 'identity' | 'company' | 'business' | 'custom'
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
  { key: 'first_name', label: 'First Name', type: 'text', required: true, explanation: 'First name or given name of the person' },
  { key: 'surname', label: 'Surname / Last Name', type: 'text', required: true, explanation: 'Last name, surname, or family name of the person' },
  { key: 'street', label: 'Street', type: 'text', required: false, explanation: 'Street name' },
  { key: 'street_number', label: 'Number', type: 'text', required: false, explanation: 'House or building number' },
  { key: 'postal_code', label: 'Postal Code / ZIP', type: 'text', required: false, explanation: 'Postal code or ZIP code' },
  { key: 'city', label: 'City', type: 'text', required: false, explanation: 'City or town name' },
  { key: 'state', label: 'State / Province', type: 'text', required: false, explanation: 'State, province, or region' },
  { key: 'country', label: 'Country', type: 'text', required: false, explanation: 'Country name' },
  { key: 'email', label: 'Email', type: 'email', required: false, explanation: 'Primary email address' },
  { key: 'phone', label: 'Phone Number', type: 'text', required: false, explanation: 'Primary phone number with country code' },
  { key: 'tax_id', label: 'Tax ID / SSN', type: 'text', required: false, explanation: 'Tax identification number or social security number' },
  { key: 'additional_info', label: 'Additional Info', type: 'textarea', required: false, explanation: 'Additional context or notes that help AI autofill match this data to forms more accurately' },
]

// Standard fields for Company
export const COMPANY_STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'ceo_first_name', label: 'CEO First Name', type: 'text', required: false, explanation: 'Chief Executive Officer first name' },
  { key: 'ceo_surname', label: 'CEO Surname', type: 'text', required: false, explanation: 'Chief Executive Officer surname or last name' },
  { key: 'street', label: 'Street', type: 'text', required: false, explanation: 'Street name' },
  { key: 'street_number', label: 'Number', type: 'text', required: false, explanation: 'House or building number' },
  { key: 'postal_code', label: 'Postal Code / ZIP', type: 'text', required: false, explanation: 'Postal code or ZIP code' },
  { key: 'city', label: 'City', type: 'text', required: false, explanation: 'City or town name' },
  { key: 'state', label: 'State / Province', type: 'text', required: false, explanation: 'State, province, or region' },
  { key: 'country', label: 'Country', type: 'text', required: false, explanation: 'Country name' },
  { key: 'email', label: 'Company Email', type: 'email', required: false, explanation: 'Primary business email address' },
  { key: 'phone', label: 'Phone Number', type: 'text', required: false, explanation: 'Business phone number' },
  { key: 'vat_number', label: 'VAT Number', type: 'text', required: false, explanation: 'Value Added Tax identification number' },
  { key: 'tax_id', label: 'Tax ID', type: 'text', required: false, explanation: 'Business tax identification number' },
  { key: 'additional_info', label: 'Additional Info', type: 'textarea', required: false, explanation: 'Additional context or notes that help AI autofill match this data to forms more accurately' },
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
  { key: 'additional_info', label: 'Additional Info', type: 'textarea', required: false, explanation: 'Additional context or notes that help AI autofill match this data to forms more accurately' },
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
