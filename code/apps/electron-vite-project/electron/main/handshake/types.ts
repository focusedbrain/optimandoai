/**
 * BEAP™ Handshake Process Flow — Type Definitions
 *
 * Canonical types for the handshake state machine, verification pipeline,
 * tier classification, context blocks, policy resolution, and IPC contract.
 *
 * These types live in the Electron main process (trusted boundary).
 */

// ── Tier ──

export type HandshakeTier = 'free' | 'pro' | 'publisher' | 'enterprise';

const TIER_ORDER: Record<HandshakeTier, number> = {
  free: 0,
  pro: 1,
  publisher: 2,
  enterprise: 3,
};

export function tierAtLeast(tier: HandshakeTier, minimum: HandshakeTier): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[minimum];
}

export function minTier(a: HandshakeTier, b: HandshakeTier): HandshakeTier {
  return TIER_ORDER[a] <= TIER_ORDER[b] ? a : b;
}

export function maxTier(a: HandshakeTier, b: HandshakeTier): HandshakeTier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}

// ── Sharing Mode ──

export type SharingMode = 'receive-only' | 'reciprocal';

// ── Action Types ──

export type ActionType =
  | 'read-context'
  | 'write-context'
  | 'decrypt-payload'
  | 'semantic-search'
  | 'cloud-escalation'
  | 'export-context';

// ── External Processing ──

export type ExternalProcessing = 'none' | 'local_only' | string;

// ── Cloud Payload Mode ──

export type CloudPayloadMode = 'none' | 'snippet' | 'full';

// ── Data Classification ──

export type DataClassification =
  | 'public'
  | 'business-confidential'
  | 'personal-data'
  | 'sensitive-personal-data';

export const ALL_DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  'public',
  'business-confidential',
  'personal-data',
  'sensitive-personal-data',
] as const;

// ── Handshake State ──

export enum HandshakeState {
  DRAFT = 'DRAFT',
  PENDING_ACCEPT = 'PENDING_ACCEPT',
  PENDING_REVIEW = 'PENDING_REVIEW',  // Acceptor imported .beap file, reviewing before accept
  ACCEPTED = 'ACCEPTED',  // Accept capsule processed; roundtrip (context exchange) not yet complete
  ACTIVE = 'ACTIVE',      // Roundtrip complete: context/signatures exchanged
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

// ── SSO Session ──

export interface SSOSession {
  wrdesk_user_id: string;
  email: string;
  iss: string;
  sub: string;
  email_verified: true;
  plan: 'free' | 'pro' | 'publisher' | 'enterprise';
  currentHardwareAttestation: { verified: true; fresh: boolean; attestedAt: string } | null;
  currentDnsVerification: { verified: true; domain: string } | null;
  currentWrStampStatus: { verified: true; stampId: string } | null;
  session_expires_at: string;
}

// ── Tier Signals ──

export interface TierSignals {
  plan: 'free' | 'pro' | 'publisher' | 'enterprise';
  hardwareAttestation: { verified: true; fresh: boolean; attestedAt: string } | null;
  dnsVerification: { verified: true; domain: string } | null;
  wrStampStatus: { verified: true; stampId: string } | null;
}

// ── Tier Decision ──

export interface TierDecision {
  claimedTier: HandshakeTier | null;
  computedTier: HandshakeTier;
  effectiveTier: HandshakeTier;
  signals: TierSignals;
  downgraded: boolean;
}

// ── Receiver Policy ──

export interface ReceiverPolicy {
  allowedScopes: string[];
  minimumTier: HandshakeTier;
  allowsCloudEscalation: boolean;
  allowsExport: boolean;
  maxContextBlocksPerHandshake: number;
  maxContextBlocksPerCapsule: number;
  maxBlockPayloadBytes: number;
  allowedSharingModes: SharingMode[];
  onRevocationDeleteBlocks: boolean;
  allowedSenderDomains: string[] | null;
  acceptedClassifications: DataClassification[];
  retentionDays: {
    'public': number;
    'business-confidential': number;
    'personal-data': number;
    'sensitive-personal-data': number;
  };
  acceptedWrdeskPolicyHashes: string[];
  cloudAiDefault: ExternalProcessing;
  allowedCloudProviders: string[];
  maxCloudPayloadBytes: number;
  cloudPayloadModeAllowed: CloudPayloadMode[];
}

export function buildDefaultReceiverPolicy(overrides?: Partial<ReceiverPolicy>): ReceiverPolicy {
  return {
    allowedScopes: ['*'],
    minimumTier: 'free',
    allowsCloudEscalation: false,
    allowsExport: false,
    maxContextBlocksPerHandshake: 1000,
    maxContextBlocksPerCapsule: 100,
    maxBlockPayloadBytes: 65536,
    allowedSharingModes: ['receive-only', 'reciprocal'],
    onRevocationDeleteBlocks: false,
    allowedSenderDomains: null,
    acceptedClassifications: [...ALL_DATA_CLASSIFICATIONS],
    retentionDays: {
      'public': 365,
      'business-confidential': 365,
      'personal-data': 90,
      'sensitive-personal-data': 30,
    },
    acceptedWrdeskPolicyHashes: ['*'],
    cloudAiDefault: 'none',
    allowedCloudProviders: [],
    maxCloudPayloadBytes: 1200,
    cloudPayloadModeAllowed: ['none', 'snippet'],
    ...overrides,
  };
}

// ── Capsule Policy ──

export interface CapsulePolicy {
  requestedScopes?: string[];
  minimumReceiverTier?: HandshakeTier;
  requireHardwareAttestation?: boolean;
  requireDnsVerification?: boolean;
  maxTtlSeconds?: number;
  maxExternalProcessing?: ExternalProcessing;
  reciprocalAllowed?: boolean;
}

// ── Effective Policy ──

export interface EffectivePolicy {
  allowedScopes: string[];
  effectiveTier: HandshakeTier;
  allowsCloudEscalation: boolean;
  allowsExport: boolean;
  onRevocationDeleteBlocks: boolean;
  effectiveExternalProcessing: ExternalProcessing;
  reciprocalAllowed: boolean;
  effectiveSharingModes: SharingMode[];
}

// ── Identity Anchor ──

export interface IdentityAnchor {
  type: 'wrdesk-public-key' | 'keycloak-sub' | 'dns-txt';
  reference: string;
}

// ── Handshake Payload (nested inside ExecutionCapsule) ──

export interface HandshakePayload {
  handshake_id: string;
  relationship_id: string;
  seq: number;
  prev_hash?: string;
  sharing_mode?: SharingMode;
  scopes?: string[];
  capsulePolicy?: CapsulePolicy;
  tierSignals: TierSignals;
  wrdesk_policy_hash: string;
  wrdesk_policy_version: string;
}

// ── Execution Capsule (internal preview model, NOT wire format) ──

export interface ExecutionCapsule {
  action: string;
  target: string;
  data_categories: DataClassification[];
  external_processing: ExternalProcessing;
  result: string;
  identity_anchors: IdentityAnchor[];
  validity_window?: string;
  reciprocal_allowed: boolean;
  handshake_payload?: HandshakePayload;
  context_blocks?: ContextBlockInput[];
}

// ── Receiver Identity (populated on confirm, null on initiate) ──

export interface ReceiverIdentity {
  email: string;
  iss: string;
  sub: string;
  email_verified: true;
  wrdesk_user_id: string;
}

// ── Context Block Input ──

export interface ContextBlockInput {
  block_id: string;
  block_hash: string;
  relationship_id: string;
  handshake_id: string;
  scope_id?: string;
  type: string;
  data_classification: DataClassification;
  version: number;
  valid_until?: string;
  payload: string;
}

// ── Verified Capsule Input (Validator → Handshake Layer boundary) ──

export type CapsuleType =
  | 'handshake-initiate'
  | 'handshake-accept'
  | 'handshake-refresh'
  | 'handshake-revoke'
  | 'handshake-context-sync';

export interface VerifiedCapsuleInput {
  schema_version: number;
  capsule_hash: string;
  context_hash: string;
  context_commitment?: string | null;
  nonce: string;
  senderIdentity: {
    email: string;
    iss: string;
    sub: string;
    email_verified: true;
    wrdesk_user_id: string;
  };
  receiverIdentity?: ReceiverIdentity | null;
  signatureValid: true;
  containerIntegrityValid: true;
  sender_wrdesk_user_id: string;
  sender_email: string;
  receiver_id: string;
  receiver_email: string;
  capsuleType: CapsuleType;
  handshake_id: string;
  seq: number;
  prev_hash?: string;
  timestamp: string;
  relationship_id: string;
  scopes?: string[];
  context_block_proofs?: ReadonlyArray<{ block_id: string; block_hash: string }>;
  capsulePolicy?: CapsulePolicy;
  expires_at?: string;
  sharing_mode?: SharingMode;
  external_processing: ExternalProcessing;
  cloud_payload_mode?: CloudPayloadMode;
  cloud_payload_bytes?: number;
  reciprocal_allowed: boolean;
  tierSignals: TierSignals;
  claimedTier?: HandshakeTier;
  preview?: ExecutionCapsule;
  wrdesk_policy_hash: string;
  wrdesk_policy_version: string;
}

// ── Party Identity ──

export interface PartyIdentity {
  email: string;
  wrdesk_user_id: string;
  iss: string;
  sub: string;
}

// ── Handshake Record (persisted) ──

export interface HandshakeRecord {
  handshake_id: string;
  relationship_id: string;
  state: HandshakeState;
  initiator: PartyIdentity;
  acceptor: PartyIdentity | null;
  local_role: 'initiator' | 'acceptor';
  sharing_mode: SharingMode | null;
  reciprocal_allowed: boolean;
  tier_snapshot: TierDecision;
  current_tier_signals: TierSignals;
  last_seq_sent: number;
  last_seq_received: number;
  last_capsule_hash_sent: string;
  last_capsule_hash_received: string;
  effective_policy: EffectivePolicy;
  external_processing: ExternalProcessing;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revocation_source: 'local-user' | 'remote-capsule' | null;
  initiator_wrdesk_policy_hash: string;
  initiator_wrdesk_policy_version: string;
  acceptor_wrdesk_policy_hash: string | null;
  acceptor_wrdesk_policy_version: string | null;
  initiator_context_commitment: string | null;
  acceptor_context_commitment: string | null;
  /** Counterparty's P2P endpoint (where we send context-sync). Full URL e.g. https://host:port/beap/ingest */
  p2p_endpoint: string | null;
  /** Counterparty's P2P auth token (Bearer) for authenticating outbound requests to them */
  counterparty_p2p_token: string | null;
  /** This device's Ed25519 public key (64-char hex) for handshake signing */
  local_public_key?: string | null;
  /** This device's Ed25519 private key (64-char hex) for signing refresh/revoke */
  local_private_key?: string | null;
  /** Counterparty's Ed25519 public key (64-char hex), stored after signature verification */
  counterparty_public_key?: string | null;
  /** For initiator PENDING_ACCEPT: intended receiver's email (from initiate capsule) */
  receiver_email?: string | null;
  /** True when context_sync was deferred (vault locked); cleared on successful enqueue */
  context_sync_pending?: boolean;
  /** Advanced policy selections (cloud_ai, internal_ai) */
  policy_selections?: { cloud_ai: boolean; internal_ai: boolean };
}

// ── Context Block (persisted) ──

export interface ContextBlock {
  block_id: string;
  block_hash: string;
  relationship_id: string;
  handshake_id: string;
  scope_id?: string;
  type: string;
  data_classification: DataClassification;
  version: number;
  valid_until?: string;
  source: 'received' | 'sent';
  sender_wrdesk_user_id: string;
  embedding_status: 'pending' | 'complete' | 'failed';
  payload_ref: string;
  /** Resolved governance (from governance_json or inferred from legacy). Present when queried with governance. */
  governance?: import('./contextGovernance').ContextItemGovernance;
}

// ── Reason Codes ──

export enum ReasonCode {
  OK = 'OK',
  UNSUPPORTED_SCHEMA = 'UNSUPPORTED_SCHEMA',
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
  HANDSHAKE_EXPIRED = 'HANDSHAKE_EXPIRED',
  HANDSHAKE_REVOKED = 'HANDSHAKE_REVOKED',
  HANDSHAKE_NOT_FOUND = 'HANDSHAKE_NOT_FOUND',
  HANDSHAKE_OWNERSHIP_VIOLATION = 'HANDSHAKE_OWNERSHIP_VIOLATION',
  DUPLICATE_ACTIVE_HANDSHAKE = 'DUPLICATE_ACTIVE_HANDSHAKE',
  INVALID_CHAIN = 'INVALID_CHAIN',
  SEQ_REPLAY = 'SEQ_REPLAY',
  INVALID_CONTEXT_BINDING = 'INVALID_CONTEXT_BINDING',
  INVALID_SHARING_MODE = 'INVALID_SHARING_MODE',
  SHARING_MODE_VIOLATION = 'SHARING_MODE_VIOLATION',
  SHARING_MODE_DENIED = 'SHARING_MODE_DENIED',
  SHARING_MODE_MUTATION_FORBIDDEN = 'SHARING_MODE_MUTATION_FORBIDDEN',
  CLOUD_PROCESSING_DENIED = 'CLOUD_PROCESSING_DENIED',
  CLOUD_PROVIDER_DENIED = 'CLOUD_PROVIDER_DENIED',
  SCOPE_ESCALATION = 'SCOPE_ESCALATION',
  POLICY_VIOLATION = 'POLICY_VIOLATION',
  RECEIVER_POLICY_UNSATISFIABLE = 'RECEIVER_POLICY_UNSATISFIABLE',
  SENDER_DOMAIN_DENIED = 'SENDER_DOMAIN_DENIED',
  WRDESK_POLICY_ANCHOR_MISMATCH = 'WRDESK_POLICY_ANCHOR_MISMATCH',
  INPUT_LIMIT_EXCEEDED = 'INPUT_LIMIT_EXCEEDED',
  CLASSIFICATION_NOT_ACCEPTED = 'CLASSIFICATION_NOT_ACCEPTED',
  EXPIRY_EXTENSION_DENIED = 'EXPIRY_EXTENSION_DENIED',
  EXPIRY_MUTATION_FORBIDDEN = 'EXPIRY_MUTATION_FORBIDDEN',
  TIER_WRSTAMP_REQUIRED = 'TIER_WRSTAMP_REQUIRED',
  TIER_DNS_REQUIRED = 'TIER_DNS_REQUIRED',
  TIER_ATTESTATION_REQUIRED = 'TIER_ATTESTATION_REQUIRED',
  TIER_ATTESTATION_STALE = 'TIER_ATTESTATION_STALE',
  TIER_BELOW_RECEIVER_MINIMUM = 'TIER_BELOW_RECEIVER_MINIMUM',
  CLOCK_SKEW = 'CLOCK_SKEW',
  DUPLICATE_CAPSULE = 'DUPLICATE_CAPSULE',
  CONTEXT_HASH_MISMATCH = 'CONTEXT_HASH_MISMATCH',
  CONTEXT_COMMITMENT_MISMATCH = 'CONTEXT_COMMITMENT_MISMATCH',
  CONTEXT_INGESTION_FAILED = 'CONTEXT_INGESTION_FAILED',
  HASH_INTEGRITY_FAILURE = 'HASH_INTEGRITY_FAILURE',
  CONTEXT_INTEGRITY_FAILURE = 'CONTEXT_INTEGRITY_FAILURE',
  CONTEXT_SYNC_REQUIRED = 'CONTEXT_SYNC_REQUIRED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  COUNTERSIGNATURE_INVALID = 'COUNTERSIGNATURE_INVALID',
}

// ── Pipeline Types ──

export type StepResult =
  | { passed: true; signals?: Partial<TierSignals> }
  | { passed: false; reason: ReasonCode };

export interface PipelineStep {
  readonly name: string;
  readonly execute: (ctx: HandshakeVerificationContext) => StepResult;
}

export interface HandshakeVerificationContext {
  input: VerifiedCapsuleInput;
  receiverPolicy: ReceiverPolicy;
  ssoSession: SSOSession;
  handshakeRecord: HandshakeRecord | null;
  signals: Partial<TierSignals>;
  tierDecision: TierDecision | null;
  /** Pre-loaded lookup: has (handshake_id, capsule_hash) been seen before? */
  seenCapsuleHashes: ReadonlySet<string>;
  /** Pre-loaded lookup: last version per (sender_wrdesk_user_id, block_id) */
  contextBlockVersions: ReadonlyMap<string, number>;
  /** Pre-loaded lookup: active/pending handshakes for ownership/dup check */
  existingHandshakes: readonly HandshakeRecord[];
  /** Local user ID for ownership checks */
  localUserId: string;
}

// ── Pipeline Result ──

export interface HandshakeVerificationSuccess {
  success: true;
  context: HandshakeVerificationContext;
}

export interface HandshakeVerificationDenial {
  success: false;
  reason: ReasonCode;
  failedStep: string;
  error?: unknown;
}

export type HandshakeVerificationResult =
  | HandshakeVerificationSuccess
  | HandshakeVerificationDenial;

// ── Process Result ──

export interface HandshakeProcessSuccess {
  success: true;
  handshakeRecord: HandshakeRecord;
  blocksStored: number;
  tierDecision: TierDecision;
  pipelineDurationMs: number;
}

export interface HandshakeProcessDenial {
  success: false;
  reason: ReasonCode;
  failedStep: string;
  detail?: string;
  pipelineDurationMs: number;
}

export type HandshakeProcessResult =
  | HandshakeProcessSuccess
  | HandshakeProcessDenial;

// ── Authorization Result ──

export interface AuthorizationResult {
  allowed: boolean;
  reason: ReasonCode;
}

// ── Vault Access Result ──

export interface VaultAccessResult {
  allowed: boolean;
  reason: ReasonCode;
  effectiveTier?: HandshakeTier;
}

// ── Scored Context Block (for semantic search) ──

export interface ScoredContextBlock extends ContextBlock {
  score: number;
}

// ── Persist Result ──

export interface PersistResult {
  inserted: number;
  deduplicated: number;
}

// ── Audit Log Entry ──

export interface AuditLogEntry {
  timestamp: string;
  action: string;
  handshake_id?: string;
  capsule_type?: string;
  reason_code: string;
  failed_step?: string;
  pipeline_duration_ms?: number;
  actor_wrdesk_user_id?: string;
  metadata?: Record<string, unknown>;
}

// ── Input Limits (constants) ──

export const INPUT_LIMITS = {
  MAX_ID_LENGTH: 256,
  MAX_HASH_LENGTH: 128,
  MAX_SCOPE_LENGTH: 256,
  MAX_TYPE_LENGTH: 128,
  MAX_PAYLOAD_BYTES_DEFAULT: 65536,
  MAX_BLOCKS_PER_CAPSULE_DEFAULT: 100,
  SCHEMA_VERSION_CURRENT: 2,
  CLOCK_SKEW_TOLERANCE_MS: 5 * 60 * 1000,
  PENDING_TIMEOUT_MS: 7 * 24 * 60 * 60 * 1000,
  RETENTION_JOB_INTERVAL_MS: 60 * 60 * 1000,
} as const;
