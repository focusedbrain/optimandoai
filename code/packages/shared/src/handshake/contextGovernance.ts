/**
 * Context Item Governance — Fine-grained policy model for handshake context
 *
 * Shared types and defaults. Enforcement and inference live in Electron main.
 */

// ── Content Type ──

export type ContentType =
  | 'message'
  | 'plaintext'
  | 'document'
  | 'user_manual'
  | 'contract'
  | 'pii'
  | 'signature_material'
  | 'api_credential'
  | 'graph_metadata'
  | 'profile_document'
  | 'other';

export const CONTENT_TYPES: readonly ContentType[] = [
  'message',
  'plaintext',
  'document',
  'user_manual',
  'contract',
  'pii',
  'signature_material',
  'api_credential',
  'graph_metadata',
  'profile_document',
  'other',
] as const;

// ── Sensitivity ──

export type Sensitivity = 'public' | 'internal' | 'confidential' | 'restricted';

export const SENSITIVITY_LEVELS: readonly Sensitivity[] = [
  'public',
  'internal',
  'confidential',
  'restricted',
] as const;

// ── Origin ──

export type ContextOrigin = 'local' | 'remote_peer' | 'third_party' | 'system_generated';

// ── Usage Policy ──

export interface UsagePolicy {
  searchable: boolean;
  local_ai_allowed: boolean;
  cloud_ai_allowed: boolean;
  auto_reply_allowed: boolean;
  export_allowed: boolean;
  transmit_to_peer_allowed: boolean;
}

export const DEFAULT_USAGE_POLICY: UsagePolicy = {
  searchable: false,
  local_ai_allowed: false,
  cloud_ai_allowed: false,
  auto_reply_allowed: false,
  export_allowed: false,
  transmit_to_peer_allowed: true, // Handshake context is shared by design
};

/** Conservative defaults for message content */
export const MESSAGE_DEFAULT_POLICY: UsagePolicy = {
  searchable: false,
  local_ai_allowed: false,
  cloud_ai_allowed: false,
  auto_reply_allowed: false,
  export_allowed: false,
  transmit_to_peer_allowed: true,
};

// ── Provenance ──

export interface ContextProvenance {
  publisher_id: string;
  sender_wrdesk_user_id: string;
  source_profile_id?: string | null;
  source_document_id?: string | null;
}

// ── Verification ──

export interface ContextVerification {
  hash_present: boolean;
  signature_present: boolean;
  commitment_linked: boolean;
}

// ── Full Governance ──

export interface ContextItemGovernance {
  origin: ContextOrigin;
  content_type: ContentType;
  sensitivity: Sensitivity;
  contains_pii: boolean;
  contains_credentials: boolean;
  contains_signature_material: boolean;
  usage_policy: UsagePolicy;
  verification: ContextVerification;
  provenance: ContextProvenance;
  /** True when governance was inferred from legacy data */
  inferred?: boolean;
}

export function createDefaultGovernance(overrides: Partial<ContextItemGovernance> = {}): ContextItemGovernance {
  return {
    origin: 'local',
    content_type: 'plaintext',
    sensitivity: 'internal',
    contains_pii: false,
    contains_credentials: false,
    contains_signature_material: false,
    usage_policy: { ...DEFAULT_USAGE_POLICY },
    verification: { hash_present: true, signature_present: false, commitment_linked: true },
    provenance: { publisher_id: '', sender_wrdesk_user_id: '' },
    ...overrides,
  };
}

export function createMessageGovernance(provenance: ContextProvenance): ContextItemGovernance {
  return createDefaultGovernance({
    content_type: 'message',
    sensitivity: 'internal',
    usage_policy: { ...MESSAGE_DEFAULT_POLICY },
    provenance,
  });
}
