// ============================================================================
// WRVault — Capability & Record-Type Specification (Single Source of Truth)
// ============================================================================
//
// Location : packages/shared/src/vault/vaultCapabilities.ts
// Re-exported by:
//   apps/extension-chromium/src/vault/capabilities.ts
//   apps/electron-vite-project/electron/main/vault/capabilities.ts
//
// ZERO external dependencies — safe to import from any runtime.
// ============================================================================

// ---------------------------------------------------------------------------
// 1. Record Types
// ---------------------------------------------------------------------------

/**
 * Vault record types — the fundamental data classification.
 *
 * | Type                | Min Tier (read) | Min Tier (write) | UI Section              |
 * |---------------------|-----------------|-----------------|-------------------------|
 * | automation_secret   | free            | free            | Secrets & API Keys      |
 * | human_credential    | pro             | pro             | Password Manager        |
 * | pii_record          | pro             | pro             | Data Manager            |
 * | company_data        | pro             | publisher       | Company Data (read-only for Pro) |
 * | document            | pro             | pro             | Document Vault          |
 * | custom              | pro             | pro             | Custom Data             |
 * | handshake_context   | publisher       | publisher       | Handshake Context       |
 */
export type VaultRecordType =
  | 'automation_secret'
  | 'human_credential'
  | 'pii_record'
  | 'company_data'
  | 'document'
  | 'custom'
  | 'handshake_context'

/** All record types in canonical display order. */
export const VAULT_RECORD_TYPES: readonly VaultRecordType[] = [
  'automation_secret',
  'human_credential',
  'pii_record',
  'company_data',
  'document',
  'custom',
  'handshake_context',
] as const

// ---------------------------------------------------------------------------
// 2. Tiers & Ordering
// ---------------------------------------------------------------------------

/**
 * Subscription tiers — aligned with auth/capabilities.ts Tier type.
 * Listed in ascending privilege order.
 * 'unknown' = session missing or tier cannot be derived (most restrictive).
 */
export type VaultTier =
  | 'free'
  | 'private'
  | 'private_lifetime'
  | 'pro'
  | 'publisher'
  | 'publisher_lifetime'
  | 'enterprise'
  | 'unknown'

/** Numeric privilege level per tier (higher = more access). unknown = -1 (no premium access). */
export const TIER_LEVEL: Record<VaultTier, number> = {
  unknown: -1,
  free: 0,
  private: 1,
  private_lifetime: 2,
  pro: 3,
  publisher: 4,
  publisher_lifetime: 5,
  enterprise: 6,
} as const

// ---------------------------------------------------------------------------
// 3. Capability Gate — minimum tier per record type
// ---------------------------------------------------------------------------

/**
 * Minimum tier required to READ each record type.
 */
export const RECORD_TYPE_MIN_TIER: Record<VaultRecordType, VaultTier> = {
  automation_secret: 'free',
  human_credential: 'pro',
  pii_record: 'pro',
  company_data: 'pro',
  document: 'pro',
  custom: 'pro',
  handshake_context: 'publisher',
} as const

/**
 * Minimum tier required to WRITE (create/update/delete) each record type.
 * If not set, defaults to RECORD_TYPE_MIN_TIER (same as read).
 * company_data: Pro can read (grandfathering), Publisher+ can write.
 */
export const RECORD_TYPE_MIN_TIER_WRITE: Partial<Record<VaultRecordType, VaultTier>> = {
  company_data: 'publisher',
} as const

// ---------------------------------------------------------------------------
// 4. Actions
// ---------------------------------------------------------------------------

/** Granular vault actions (for future fine-grained policy gating). */
export type VaultAction = 'read' | 'write' | 'delete' | 'export' | 'share'

/**
 * Actions allowed per tier (additive — higher tiers unlock more).
 * All tiers get read/write/delete for their allowed record types.
 * Export and share are gated to higher tiers.
 */
export const TIER_ALLOWED_ACTIONS: Record<VaultTier, readonly VaultAction[]> = {
  unknown: [],
  free: ['read', 'write', 'delete'],
  private: ['read', 'write', 'delete', 'export'],
  private_lifetime: ['read', 'write', 'delete', 'export'],
  pro: ['read', 'write', 'delete', 'export'],
  publisher: ['read', 'write', 'delete', 'export', 'share'],
  publisher_lifetime: ['read', 'write', 'delete', 'export', 'share'],
  enterprise: ['read', 'write', 'delete', 'export', 'share'],
} as const

// ---------------------------------------------------------------------------
// 5. Access Check Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a tier can perform an action on a record type.
 *
 * @param tier       - User's resolved subscription tier
 * @param recordType - The vault record type being accessed
 * @param action     - The action being performed (default: 'read')
 * @returns true if the tier permits the action on the record type
 *
 * @example
 *   canAccessRecordType('free', 'automation_secret')          // true
 *   canAccessRecordType('free', 'human_credential')           // false
 *   canAccessRecordType('pro', 'human_credential', 'export')  // true
 *   canAccessRecordType('free', 'automation_secret', 'share') // false
 *   canAccessRecordType('publisher', 'handshake_context')     // true
 */
export function canAccessRecordType(
  tier: VaultTier,
  recordType: VaultRecordType,
  action: VaultAction = 'read',
): boolean {
  // unknown = no access (most restrictive)
  if (tier === 'unknown') return false

  const userLevel = TIER_LEVEL[tier] ?? 0

  // 1. For read: use RECORD_TYPE_MIN_TIER. For write/delete: use RECORD_TYPE_MIN_TIER_WRITE if set.
  const minTierForAction =
    action === 'read'
      ? RECORD_TYPE_MIN_TIER[recordType]
      : (RECORD_TYPE_MIN_TIER_WRITE[recordType] ?? RECORD_TYPE_MIN_TIER[recordType])
  const requiredLevel = TIER_LEVEL[minTierForAction] ?? 0

  if (userLevel < requiredLevel) return false

  // 2. Action must be allowed for the user's tier
  const allowedActions = TIER_ALLOWED_ACTIONS[tier] ?? []
  return (allowedActions as readonly string[]).includes(action)
}

/**
 * Return all record types accessible at a given tier.
 */
export function getAccessibleRecordTypes(tier: VaultTier): VaultRecordType[] {
  return VAULT_RECORD_TYPES.filter(rt => canAccessRecordType(tier, rt))
}

// ---------------------------------------------------------------------------
// 6. Display Metadata
// ---------------------------------------------------------------------------

export interface RecordTypeDisplayInfo {
  /** Short label shown in UI tabs and buttons. */
  label: string
  /** Emoji icon for the record type. */
  icon: string
  /** One-line description for tooltips / help text. */
  description: string
  /** UI section heading this record type falls under. */
  section: string
  /** Minimum tier for display/gating hints. */
  minTier: VaultTier
}

/** UI display metadata for each record type. */
export const RECORD_TYPE_DISPLAY: Record<VaultRecordType, RecordTypeDisplayInfo> = {
  automation_secret: {
    label: 'Secrets & API Keys',
    icon: '\u{1F510}',
    description: 'API keys, tokens, and secrets for automation and integrations',
    section: 'Secrets & API Keys',
    minTier: 'free',
  },
  human_credential: {
    label: 'Password Manager',
    icon: '\u{1F511}',
    description: 'Website logins, application passwords, and credentials',
    section: 'Password Manager',
    minTier: 'pro',
  },
  pii_record: {
    label: 'Data Manager',
    icon: '\u{1F464}',
    description: 'Personal identity and company information',
    section: 'Data Manager',
    minTier: 'pro',
  },
  document: {
    label: 'Document Vault',
    icon: '\u{1F4C4}',
    description: 'Encrypted document and file storage',
    section: 'Document Vault',
    minTier: 'pro',
  },
  custom: {
    label: 'Custom Data',
    icon: '\u{1F4DD}',
    description: 'User-defined structured data entries',
    section: 'Custom Data',
    minTier: 'pro',
  },
  company_data: {
    label: 'Company Data',
    icon: '\u{1F3E2}',
    description: 'Company and business information',
    section: 'Data Manager',
    minTier: 'publisher',
  },
  handshake_context: {
    label: 'HS Context',
    icon: '\u{1F91D}',
    description: 'Data bound into cryptographic handshakes for trust verification',
    section: 'HS Context',
    minTier: 'publisher',
  },
}

// ---------------------------------------------------------------------------
// 7. Legacy Category Mapping (backwards compatibility)
// ---------------------------------------------------------------------------

/**
 * Storage-level item categories (DB schema).
 * `automation_secret` was added so Free-tier users have a real category.
 * The remaining legacy names map to VaultRecordType for tier gating.
 */
export type LegacyItemCategory =
  | 'automation_secret'
  | 'password'
  | 'identity'
  | 'company'
  | 'custom'
  | 'document'
  | 'handshake_context'

/**
 * Map existing DB-level ItemCategory → VaultRecordType.
 */
export const LEGACY_CATEGORY_TO_RECORD_TYPE: Record<LegacyItemCategory, VaultRecordType> = {
  automation_secret: 'automation_secret',
  password: 'human_credential',
  identity: 'pii_record',
  company: 'company_data',
  custom: 'custom',
  document: 'document',
  handshake_context: 'handshake_context',
} as const

/**
 * Map VaultRecordType → default legacy ItemCategory for DB storage.
 * For pii_record the specific sub-type (identity/company) is
 * determined by context, so we default to 'identity'.
 * null = new type with no legacy equivalent (schema extension needed).
 */
export const RECORD_TYPE_TO_DEFAULT_CATEGORY: Record<VaultRecordType, LegacyItemCategory | null> = {
  automation_secret: 'automation_secret',
  human_credential: 'password',
  pii_record: 'identity',
  company_data: 'company',
  document: 'document',
  custom: 'custom',
  handshake_context: 'handshake_context',
} as const

// ---------------------------------------------------------------------------
// 8. Sidebar / Create-Dialog Label Mapping
// ---------------------------------------------------------------------------

/**
 * Updated UI labels for legacy sidebar categories.
 * Keeps existing structure intact while aligning terminology.
 *
 * Before → After:
 *   "Passwords"       → "Password Manager"
 *   "Private Data"    → "Private Data"  (sub-item of Data Manager)
 *   "Company Data"    → "Company Data"  (sub-item of Data Manager)
 *   "Business Data"   → "Business Data" (sub-item of Data Manager)
 *   "Custom Data"     → "Custom Data"
 */
export interface CategoryUILabel {
  /** Label for sidebar tree and category filter buttons. */
  sidebarLabel: string
  /** Label for the "Add Data" / create-item dialog. */
  createDialogLabel: string
  /** Emoji icon. */
  icon: string
  /** The VaultRecordType this category maps to. */
  recordType: VaultRecordType
}

export const CATEGORY_UI_MAP: Record<LegacyItemCategory, CategoryUILabel> = {
  automation_secret: {
    sidebarLabel: 'Secrets & API Keys',
    createDialogLabel: 'Secrets & API Keys',
    icon: '\u{1F510}',
    recordType: 'automation_secret',
  },
  password: {
    sidebarLabel: 'Password Manager',
    createDialogLabel: 'Password Manager',
    icon: '\u{1F511}',
    recordType: 'human_credential',
  },
  identity: {
    sidebarLabel: 'Private Data',
    createDialogLabel: 'Private Data',
    icon: '\u{1F464}',
    recordType: 'pii_record',
  },
  company: {
    sidebarLabel: 'Company Data',
    createDialogLabel: 'Company Data',
    icon: '\u{1F3E2}',
    recordType: 'company_data',
  },
  custom: {
    sidebarLabel: 'Custom Data',
    createDialogLabel: 'Custom Data',
    icon: '\u{1F4DD}',
    recordType: 'custom',
  },
  document: {
    sidebarLabel: 'Document Vault',
    createDialogLabel: 'Document Vault',
    icon: '\u{1F4C4}',
    recordType: 'document',
  },
  handshake_context: {
    sidebarLabel: 'HS Context',
    createDialogLabel: 'HS Context',
    icon: '\u{1F91D}',
    recordType: 'handshake_context',
  },
}

/**
 * Helper: get the create-dialog category options filtered by tier.
 * Returns only legacy categories whose mapped record type the tier can access.
 */
/**
 * All item categories in sidebar / create-dialog display order.
 * `automation_secret` comes first because it is the only Free-tier category.
 */
export const ALL_ITEM_CATEGORIES: readonly LegacyItemCategory[] = [
  'automation_secret',
  'password',
  'identity',
  'company',
  'custom',
  'document',
  'handshake_context',
] as const

/**
 * Get category options for the create dialog (write access required).
 * Use action='write' so Pro users don't see Company Data in the create dropdown.
 */
export function getCategoryOptionsForTier(
  tier: VaultTier,
  action: VaultAction = 'write',
): Array<{ value: LegacyItemCategory; label: string; icon: string }> {
  return (ALL_ITEM_CATEGORIES as readonly LegacyItemCategory[])
    .filter(cat => canAccessRecordType(tier, CATEGORY_UI_MAP[cat].recordType, action))
    .map(cat => ({
      value: cat,
      label: `${CATEGORY_UI_MAP[cat].icon} ${CATEGORY_UI_MAP[cat].createDialogLabel}`,
      icon: CATEGORY_UI_MAP[cat].icon,
    }))
}

/**
 * Check whether a given ItemCategory is accessible at a specific tier.
 */
export function canAccessCategory(
  tier: VaultTier,
  category: LegacyItemCategory,
  action: VaultAction = 'read',
): boolean {
  const recordType = LEGACY_CATEGORY_TO_RECORD_TYPE[category]
  if (!recordType) return false
  return canAccessRecordType(tier, recordType, action)
}

// ---------------------------------------------------------------------------
// 10. Handshake Context — Binding Policy & Evaluation
// ---------------------------------------------------------------------------

/**
 * Binding policy metadata stored alongside a handshake context item.
 * Serialised as JSON in the vault_items.meta column.
 *
 * Controls WHEN and WHERE a context item may be attached to a handshake.
 */
export interface HandshakeBindingPolicy {
  /** Domains this context may be shared with (glob patterns: '*.example.com'). Empty = any domain. */
  allowed_domains: string[]
  /** Handshake type tags this context is valid for (e.g. 'support', 'sales'). Empty = any type. */
  handshake_types: string[]
  /** Unix timestamp (ms) after which this context expires. null = no expiry. */
  valid_until: number | null
  /** Must be explicitly set to true before context can be attached. Default false. */
  safe_to_share: boolean
  /** If true, the user must re-authenticate (step-up) before attaching. Default false. */
  step_up_required: boolean
}

/** Default (empty) binding policy for newly created context items. */
export const DEFAULT_BINDING_POLICY: HandshakeBindingPolicy = {
  allowed_domains: [],
  handshake_types: [],
  valid_until: null,
  safe_to_share: false,
  step_up_required: false,
}

/**
 * Runtime handshake parameters passed into `canAttachContext`.
 * Represents the handshake that wants to consume a context item.
 */
export interface HandshakeTarget {
  /** The domain of the handshake peer (e.g. 'partner.example.com'). */
  domain: string
  /** The handshake type tag (e.g. 'sales', 'onboarding'). */
  type?: string
  /** Whether the user has completed a step-up authentication. */
  step_up_done?: boolean
}

/** Reason codes returned by `canAttachContext` when attachment is blocked. */
export type AttachBlockReason =
  | 'tier_insufficient'
  | 'not_safe_to_share'
  | 'domain_mismatch'
  | 'type_mismatch'
  | 'expired'
  | 'step_up_required'

export interface AttachEvalResult {
  allowed: boolean
  /** Populated only when `allowed === false`. */
  reason?: AttachBlockReason
  /** Human-readable explanation suitable for UI display. */
  message?: string
}

/**
 * Evaluate whether a handshake context item may be attached to a handshake.
 *
 * Checks are evaluated in fail-fast order (most fundamental first):
 *   1. Tier capability (Publisher+)
 *   2. safe_to_share flag
 *   3. Domain binding
 *   4. Handshake type binding
 *   5. TTL / valid_until
 *   6. Step-up requirement
 *
 * @param tier    - User's subscription tier
 * @param policy  - The context item's binding policy (from meta JSON)
 * @param target  - The handshake requesting the context
 * @returns An evaluation result with allowed/blocked and an explanation.
 */
export function canAttachContext(
  tier: VaultTier,
  policy: HandshakeBindingPolicy,
  target: HandshakeTarget,
): AttachEvalResult {
  // 1. Tier capability
  if (!canAccessRecordType(tier, 'handshake_context', 'share')) {
    return {
      allowed: false,
      reason: 'tier_insufficient',
      message: `Your plan (${tier}) does not support sharing handshake context. Publisher or higher required.`,
    }
  }

  // 2. safe_to_share
  if (!policy.safe_to_share) {
    return {
      allowed: false,
      reason: 'not_safe_to_share',
      message: 'This context item is not marked as safe to share. Enable "Safe to Share" in the item settings.',
    }
  }

  // 3. Domain binding
  if (policy.allowed_domains.length > 0) {
    const domainMatch = policy.allowed_domains.some(pattern =>
      matchDomainGlob(pattern, target.domain),
    )
    if (!domainMatch) {
      return {
        allowed: false,
        reason: 'domain_mismatch',
        message: `Domain "${target.domain}" is not in the allowed domains list (${policy.allowed_domains.join(', ')}).`,
      }
    }
  }

  // 4. Handshake type binding
  if (policy.handshake_types.length > 0 && target.type) {
    if (!policy.handshake_types.includes(target.type)) {
      return {
        allowed: false,
        reason: 'type_mismatch',
        message: `Handshake type "${target.type}" is not allowed (expected: ${policy.handshake_types.join(', ')}).`,
      }
    }
  }

  // 5. TTL / valid_until
  if (policy.valid_until !== null && Date.now() > policy.valid_until) {
    return {
      allowed: false,
      reason: 'expired',
      message: `This context item expired on ${new Date(policy.valid_until).toLocaleDateString()}.`,
    }
  }

  // 6. Step-up
  if (policy.step_up_required && !target.step_up_done) {
    return {
      allowed: false,
      reason: 'step_up_required',
      message: 'This context item requires re-authentication before sharing.',
    }
  }

  return { allowed: true }
}

/**
 * Simple glob-style domain matcher.
 * Supports leading wildcard: '*.example.com' matches 'sub.example.com'
 * Exact match: 'example.com' matches only 'example.com'
 */
export function matchDomainGlob(pattern: string, domain: string): boolean {
  const p = pattern.toLowerCase().trim()
  const d = domain.toLowerCase().trim()
  if (p === d) return true
  if (p.startsWith('*.')) {
    const suffix = p.slice(1) // '.example.com'
    return d.endsWith(suffix) || d === p.slice(2)
  }
  return false
}
