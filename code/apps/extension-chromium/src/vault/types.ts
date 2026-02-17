/**
 * Type definitions for vault entities (shared with Electron)
 */

// Re-export capability types and helpers for convenient access
export type {
  VaultRecordType,
  VaultTier,
  VaultAction,
  LegacyItemCategory,
  RecordTypeDisplayInfo,
  CategoryUILabel,
  HandshakeBindingPolicy,
  HandshakeTarget,
  AttachBlockReason,
  AttachEvalResult,
} from './capabilities'
export {
  VAULT_RECORD_TYPES,
  TIER_LEVEL,
  RECORD_TYPE_MIN_TIER,
  TIER_ALLOWED_ACTIONS,
  RECORD_TYPE_DISPLAY,
  CATEGORY_UI_MAP,
  LEGACY_CATEGORY_TO_RECORD_TYPE,
  RECORD_TYPE_TO_DEFAULT_CATEGORY,
  ALL_ITEM_CATEGORIES,
  DEFAULT_BINDING_POLICY,
  canAccessRecordType,
  getAccessibleRecordTypes,
  getCategoryOptionsForTier,
  canAccessCategory,
  canAttachContext,
  matchDomainGlob,
} from './capabilities'

export type ContainerType = 'person' | 'company' | 'business'
export type ItemCategory = 'automation_secret' | 'password' | 'identity' | 'company' | 'business' | 'custom' | 'document' | 'handshake_context'
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
  { key: 'date_of_birth', label: 'Date of Birth', type: 'text', required: false, explanation: 'Date of birth (DD.MM.YYYY or YYYY-MM-DD)' },
  { key: 'tax_id', label: 'Tax ID / SSN', type: 'text', required: false, explanation: 'Tax identification number or social security number' },
  { key: 'additional_info', label: 'Additional Info', type: 'textarea', required: false, explanation: 'Additional context or notes that help AI autofill match this data to forms more accurately' },
]

// Payment method fields (reusable across Identity, Company, Business)
export const PAYMENT_FIELDS: StandardFieldDef[] = [
  { key: 'iban', label: 'IBAN', type: 'text', required: false, explanation: 'International Bank Account Number (e.g. DE89 3704 0044 0532 0130 00)' },
  { key: 'bic', label: 'BIC / SWIFT', type: 'text', required: false, explanation: 'Bank Identifier Code or SWIFT code' },
  { key: 'bank_name', label: 'Bank Name', type: 'text', required: false, explanation: 'Name of the bank or financial institution' },
  { key: 'account_holder', label: 'Account Holder', type: 'text', required: false, explanation: 'Name on the bank account' },
  { key: 'cc_number', label: 'Credit Card Number', type: 'password', required: false, explanation: 'Credit or debit card number' },
  { key: 'cc_holder', label: 'Cardholder Name', type: 'text', required: false, explanation: 'Name on the credit or debit card' },
  { key: 'cc_expiry', label: 'Expiry Date', type: 'text', required: false, explanation: 'Card expiry date (MM/YY)' },
  { key: 'cc_cvv', label: 'CVV / CVC', type: 'password', required: false, explanation: 'Card verification value (3 or 4 digit security code)' },
  { key: 'paypal_email', label: 'PayPal Email', type: 'email', required: false, explanation: 'Email address linked to PayPal account' },
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
  { key: 'website', label: 'Website', type: 'url', required: false, explanation: 'Company website URL' },
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

// Standard fields for Automation Secrets & API Keys (Free+ record type)
export const AUTOMATION_SECRET_STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'service_name', label: 'Service / Provider', type: 'text', required: true, explanation: 'Name of the API or service (e.g., OpenAI, Stripe, AWS)' },
  { key: 'key_name', label: 'Key Name / Identifier', type: 'text', required: false, explanation: 'Label or identifier for the key (e.g., Production API Key, Staging Token)' },
  { key: 'secret', label: 'Secret / API Key', type: 'password', required: true, explanation: 'The API key, token, or secret value' },
  { key: 'endpoint', label: 'API Endpoint / Base URL', type: 'url', required: false, explanation: 'Base URL or endpoint for the API service' },
  { key: 'expires_at', label: 'Expiration Date', type: 'text', required: false, explanation: 'When this key expires (ISO date or descriptive)' },
  { key: 'notes', label: 'Notes', type: 'textarea', required: false, explanation: 'Additional notes about usage, rate limits, or rotation schedule' },
]

// Standard fields for Document Vault entries
// Documents are uploaded as files; these fields hold only the metadata label.
export const DOCUMENT_STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'notes', label: 'Notes', type: 'textarea', required: false, explanation: 'Additional notes or description for this document' },
]

// Standard fields for Handshake Context entries (Publisher+)
export const HANDSHAKE_CONTEXT_STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'context_type', label: 'Context Type', type: 'text', required: true, explanation: 'Type of context (e.g., Personalized Offer, User Manual, Support Profile)' },
  { key: 'summary', label: 'Summary', type: 'text', required: true, explanation: 'Short description of the context payload' },
  { key: 'payload', label: 'Context Payload', type: 'textarea', required: true, explanation: 'The data to be attached to a handshake (offer details, manual content, profile data, etc.)' },
  { key: 'notes', label: 'Notes', type: 'textarea', required: false, explanation: 'Internal notes (not shared in the handshake)' },
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
  /** User's resolved subscription tier (for capability gating). */
  tier?: string
  /** Available unlock provider types for the current vault. */
  unlockProviders?: Array<{ id: string; name: string }>
  /** The active (default) provider type for the current vault. */
  activeProviderType?: string
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
