/**
 * Context Item Governance — Resolution and inference for handshake context
 *
 * Resolves effective governance per item: handshake baseline + item override.
 * Infers governance for legacy records without governance_json.
 */

import type {
  ContextItemGovernance,
  UsagePolicy,
  ContentType,
  Sensitivity,
  ContextOrigin,
  ContextProvenance,
  ContextVerification,
} from '../../../../../packages/shared/src/handshake/contextGovernance'
import {
  createDefaultGovernance,
  createMessageGovernance,
  DEFAULT_USAGE_POLICY,
  MESSAGE_DEFAULT_POLICY,
} from '../../../../../packages/shared/src/handshake/contextGovernance'
import type { EffectivePolicy } from './types'
import type { HandshakeRecord } from './types'
import type { DataClassification } from './types'

// Re-export for consumers
export type {
  ContextItemGovernance,
  UsagePolicy,
  ContentType,
  Sensitivity,
  ContextOrigin,
  ContextProvenance,
  ContextVerification,
}
export {
  createDefaultGovernance,
  createMessageGovernance,
  DEFAULT_USAGE_POLICY,
  MESSAGE_DEFAULT_POLICY,
} from '../../../../../packages/shared/src/handshake/contextGovernance'

// ── Type mapping ──

const BLOCK_TYPE_TO_CONTENT_TYPE: Record<string, ContentType> = {
  message: 'message',
  plaintext: 'plaintext',
  vault_profile: 'profile_document',
  document: 'document',
  user_manual: 'user_manual',
  contract: 'contract',
  pii: 'pii',
  signature: 'signature_material',
  api_credential: 'api_credential',
  graph_metadata: 'graph_metadata',
}

const DATA_CLASSIFICATION_TO_SENSITIVITY: Record<string, Sensitivity> = {
  public: 'public',
  'business-confidential': 'confidential',
  'personal-data': 'confidential',
  'sensitive-personal-data': 'restricted',
}

// ── Baseline from handshake ──

export interface HandshakeBaselinePolicy {
  searchable: boolean;
  local_ai_allowed: boolean;
  cloud_ai_allowed: boolean;
  auto_reply_allowed: boolean;
  export_allowed: boolean;
  transmit_to_peer_allowed: boolean;
}

export function baselineFromHandshake(record: HandshakeRecord): HandshakeBaselinePolicy {
  const policy = record.effective_policy
  const selections = record.policy_selections
  return {
    searchable: true, // Default allow for search
    local_ai_allowed: selections?.internal_ai ?? true,
    cloud_ai_allowed: selections?.cloud_ai ?? policy?.allowsCloudEscalation ?? false,
    auto_reply_allowed: false, // Conservative default
    export_allowed: policy?.allowsExport ?? false,
    transmit_to_peer_allowed: true, // Handshake context is shared by design
  }
}

/**
 * Build baseline from explicit policy_selections (e.g. from RPC request).
 * Fallback: effective_policy when selections omit a field.
 */
export function baselineFromPolicySelections(
  selections: { cloud_ai?: boolean; internal_ai?: boolean } | null | undefined,
  effectivePolicy?: { allowsCloudEscalation?: boolean; allowsExport?: boolean } | null,
): HandshakeBaselinePolicy {
  return {
    searchable: true,
    local_ai_allowed: selections?.internal_ai ?? true,
    cloud_ai_allowed: selections?.cloud_ai ?? effectivePolicy?.allowsCloudEscalation ?? false,
    auto_reply_allowed: false,
    export_allowed: effectivePolicy?.allowsExport ?? false,
    transmit_to_peer_allowed: true,
  }
}

// ── Parse governance JSON ──

export function parseGovernanceJson(json: string | null | undefined): ContextItemGovernance | null {
  if (!json || json === '{}') return null
  try {
    const parsed = JSON.parse(json) as Partial<ContextItemGovernance>
    if (!parsed.usage_policy || !parsed.provenance) return null
    return parsed as ContextItemGovernance
  } catch {
    return null
  }
}

// ── Infer governance from legacy block ──

export interface LegacyBlockInput {
  block_id: string
  type: string
  data_classification?: string
  scope_id?: string
  sender_wrdesk_user_id: string
  publisher_id?: string
  source?: 'received' | 'sent'
}

export function inferGovernanceFromLegacy(
  block: LegacyBlockInput,
  handshakeRecord: HandshakeRecord,
  relationshipId: string,
): ContextItemGovernance {
  const isMessage = block.type === 'message' || block.block_id?.startsWith('ctx-msg')
  const contentType: ContentType = BLOCK_TYPE_TO_CONTENT_TYPE[block.type] ?? (isMessage ? 'message' : 'plaintext')
  const sensitivity: Sensitivity =
    DATA_CLASSIFICATION_TO_SENSITIVITY[block.data_classification ?? 'public'] ?? 'internal'

  const provenance: ContextProvenance = {
    publisher_id: block.publisher_id ?? block.sender_wrdesk_user_id,
    sender_wrdesk_user_id: block.sender_wrdesk_user_id,
  }

  const baseline = baselineFromHandshake(handshakeRecord)

  let usagePolicy: UsagePolicy
  if (isMessage) {
    usagePolicy = { ...MESSAGE_DEFAULT_POLICY }
  } else {
    usagePolicy = { ...baseline }
  }

  const verification: ContextVerification = {
    hash_present: true,
    signature_present: false,
    commitment_linked: true,
  }

  const origin: ContextOrigin = block.source === 'received' ? 'remote_peer' : 'local'

  return {
    origin,
    content_type: contentType,
    sensitivity,
    contains_pii: block.data_classification === 'personal-data' || block.data_classification === 'sensitive-personal-data',
    contains_credentials: block.type === 'api_credential',
    contains_signature_material: block.type === 'signature' || block.type === 'signature_material',
    usage_policy: usagePolicy,
    verification,
    provenance,
    inferred: true,
  }
}

// ── Resolve effective governance ──

export function resolveEffectiveGovernance(
  itemGovernance: ContextItemGovernance | null,
  block: LegacyBlockInput,
  handshakeRecord: HandshakeRecord,
  relationshipId: string,
): ContextItemGovernance {
  const resolved = itemGovernance ?? inferGovernanceFromLegacy(block, handshakeRecord, relationshipId)
  return resolved
}

// ── Purpose-based filtering (item-level enforcement) ──

/** Block with resolved governance. Used by filter helpers. */
export interface BlockWithGovernance {
  governance?: ContextItemGovernance | null
  [key: string]: unknown
}

/** Check if item-level usage policy allows the given action. Explicit deny wins. */
function itemAllowsUsage(
  governance: ContextItemGovernance | null | undefined,
  field: keyof UsagePolicy,
  denyByDefault: boolean,
): boolean {
  if (!governance?.usage_policy) return !denyByDefault
  const val = governance.usage_policy[field]
  if (val === false) return false
  if (val === true) return true
  return !denyByDefault
}

/** Filter blocks for local AI. Explicit deny wins. Legacy/inferred: allow for backward compat. */
export function filterBlocksForLocalAI<T extends BlockWithGovernance>(
  blocks: T[],
  _baseline?: HandshakeBaselinePolicy | null,
): T[] {
  return blocks.filter((b) => itemAllowsUsage(b.governance, 'local_ai_allowed', false))
}

/** Filter blocks for cloud AI. Explicit deny wins. Missing/inferred: deny (conservative). */
export function filterBlocksForCloudAI<T extends BlockWithGovernance>(
  blocks: T[],
  baseline?: HandshakeBaselinePolicy | null,
): T[] {
  if (baseline && baseline.cloud_ai_allowed === false) return []
  return blocks.filter((b) => itemAllowsUsage(b.governance, 'cloud_ai_allowed', true))
}

/** Filter blocks for export. Explicit deny wins. Missing: deny (conservative). */
export function filterBlocksForExport<T extends BlockWithGovernance>(
  blocks: T[],
  baseline?: HandshakeBaselinePolicy | null,
): T[] {
  if (baseline && baseline.export_allowed === false) return []
  return blocks.filter((b) => itemAllowsUsage(b.governance, 'export_allowed', true))
}

/** Filter blocks for search/embedding. Explicit deny wins. Legacy: allow for backward compat. */
export function filterBlocksForSearch<T extends BlockWithGovernance>(
  blocks: T[],
  _baseline?: HandshakeBaselinePolicy | null,
): T[] {
  return blocks.filter((b) => itemAllowsUsage(b.governance, 'searchable', false))
}

/** Filter blocks for peer transmission. Explicit deny wins. Legacy: allow (handshake context is shared). */
export function filterBlocksForPeerTransmission<T extends BlockWithGovernance>(
  blocks: T[],
  baseline?: HandshakeBaselinePolicy | null,
): T[] {
  if (baseline && baseline.transmit_to_peer_allowed === false) return []
  return blocks.filter((b) => itemAllowsUsage(b.governance, 'transmit_to_peer_allowed', false))
}

/** Filter blocks for auto-reply/automation. Explicit deny wins. Missing: deny (conservative). */
export function filterBlocksForAutoReply<T extends BlockWithGovernance>(
  blocks: T[],
  baseline?: HandshakeBaselinePolicy | null,
): T[] {
  if (baseline && baseline.auto_reply_allowed === false) return []
  return blocks.filter((b) => itemAllowsUsage(b.governance, 'auto_reply_allowed', true))
}
