/**
 * BEAP™ Handshake Capsule Builder — Sender Side
 *
 * Constructs valid handshake wire capsules for all capsule types:
 *   - initiate   → sent by the party initiating a handshake
 *   - accept     → sent by the party accepting an initiate
 *   - refresh    → sent by either party to update context blocks
 *   - revoke     → sent by either party to revoke the handshake
 *
 * Every capsule produced by this builder will pass the Validator's 10-step
 * check and the Handshake Pipeline's 20-step process when submitted via the
 * Ingestor (provided the receiver's policy is compatible).
 *
 * Key correctness invariants enforced here:
 *   - schema_version is always 1
 *   - seq is always 0 for initiate and accept (independent chains)
 *   - seq for refresh/revoke is last_seq_received + 1
 *   - prev_hash is absent on initiate/accept, required on refresh (and ignored on revoke)
 *   - sharing_mode is absent on initiate, required on accept
 *   - capsule_hash is computed over canonical fields (SHA-256)
 *   - wrdesk_policy_hash is computed from the sender's active PolicyDescriptor
 *   - relationship_id is derived symmetrically from both user IDs
 *
 * Transports (how to send the capsule):
 *   Use `submitCapsuleViaRpc()` in capsuleTransport.ts to deliver a built
 *   capsule to the receiver's ingestion pipeline via the RPC interface.
 */

import { randomUUID } from 'crypto'
import type { SSOSession, SharingMode, TierSignals, ContextBlockInput } from './types'
import { computeCapsuleHash, type CapsuleHashInput } from './capsuleHash'
import { computePolicyHash, DEFAULT_POLICY_DESCRIPTOR, type PolicyDescriptor } from './policyHash'
import { deriveRelationshipId } from './relationshipId'

// ── Wire format types ──

export interface HandshakeCapsuleWire {
  readonly schema_version: 1;
  readonly capsule_type: 'initiate' | 'accept' | 'refresh' | 'revoke';
  readonly handshake_id: string;
  readonly relationship_id: string;
  readonly sender_id: string;
  readonly sender_wrdesk_user_id: string;
  readonly senderIdentity: {
    readonly email: string;
    readonly iss: string;
    readonly sub: string;
    readonly email_verified: true;
    readonly wrdesk_user_id: string;
  };
  readonly capsule_hash: string;
  readonly timestamp: string;
  readonly seq: number;
  readonly external_processing: 'none' | 'local_only';
  readonly reciprocal_allowed: boolean;
  readonly tierSignals: TierSignals;
  readonly wrdesk_policy_hash: string;
  readonly wrdesk_policy_version: string;
  // Type-specific (present only when needed)
  readonly sharing_mode?: SharingMode;
  readonly prev_hash?: string;
  readonly context_blocks?: ReadonlyArray<ContextBlockInput>;
}

// ── Options types ──

export interface InitiateOptions {
  /** ID of the party being invited (receiver's wrdesk_user_id) */
  receiverUserId: string;
  /** Whether the initiator allows the acceptor to also share context back */
  reciprocal_allowed?: boolean;
  /** External processing mode. Defaults to 'none'. */
  external_processing?: 'none' | 'local_only';
  /** Policy descriptor to anchor. Defaults to DEFAULT_POLICY_DESCRIPTOR. */
  policy?: PolicyDescriptor;
  /** Explicit handshake_id override (generated if absent) */
  handshake_id?: string;
  /** Explicit timestamp override (current time if absent) */
  timestamp?: string;
}

export interface AcceptOptions {
  /** The handshake_id from the initiate capsule received */
  handshake_id: string;
  /** The initiator's wrdesk_user_id (from the received initiate capsule) */
  initiatorUserId: string;
  /** Sharing mode chosen by the acceptor */
  sharing_mode: SharingMode;
  /** Whether acceptor allows reciprocal sharing (must match sharing_mode) */
  reciprocal_allowed?: boolean;
  /** External processing mode. Defaults to 'none'. */
  external_processing?: 'none' | 'local_only';
  /** Policy descriptor to anchor. Defaults to DEFAULT_POLICY_DESCRIPTOR. */
  policy?: PolicyDescriptor;
  /** Explicit timestamp override (current time if absent) */
  timestamp?: string;
}

export interface RefreshOptions {
  /** The handshake_id of the active handshake */
  handshake_id: string;
  /** The counterparty's wrdesk_user_id */
  counterpartyUserId: string;
  /** The seq of the last capsule received FROM the counterparty */
  last_seq_received: number;
  /** The hash of the last capsule received FROM the counterparty */
  last_capsule_hash_received: string;
  /** Context blocks (message payload) to include in this refresh */
  context_blocks?: ReadonlyArray<ContextBlockInput>;
  /** Policy descriptor to anchor. Defaults to DEFAULT_POLICY_DESCRIPTOR. */
  policy?: PolicyDescriptor;
  /** Explicit timestamp override */
  timestamp?: string;
}

export interface RevokeOptions {
  /** The handshake_id of the handshake to revoke */
  handshake_id: string;
  /** The counterparty's wrdesk_user_id */
  counterpartyUserId: string;
  /** The seq of the last capsule received FROM the counterparty */
  last_seq_received: number;
  /** The hash of the last capsule received FROM the counterparty */
  last_capsule_hash_received: string;
  /** Explicit timestamp override */
  timestamp?: string;
}

// ── Builder functions ──

/**
 * Build an `initiate` handshake capsule.
 *
 * The sender is identified by `session.wrdesk_user_id`.
 * A new `handshake_id` and `relationship_id` are generated.
 * `seq` is always `0` (first capsule in the initiate chain).
 */
export function buildInitiateCapsule(
  session: SSOSession,
  opts: InitiateOptions,
): HandshakeCapsuleWire {
  const timestamp = opts.timestamp ?? new Date().toISOString()
  const handshake_id = opts.handshake_id ?? `hs-${randomUUID()}`
  const relationship_id = deriveRelationshipId(session.wrdesk_user_id, opts.receiverUserId)
  const policy = opts.policy ?? DEFAULT_POLICY_DESCRIPTOR

  const hashInput: CapsuleHashInput = {
    capsule_type: 'initiate',
    handshake_id,
    relationship_id,
    schema_version: 1,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    seq: 0,
    timestamp,
    wrdesk_policy_hash: computePolicyHash(policy),
    wrdesk_policy_version: policy.version,
  }

  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    senderIdentity: {
      email: session.email,
      iss: session.iss,
      sub: session.sub,
      email_verified: true,
      wrdesk_user_id: session.wrdesk_user_id,
    },
    capsule_hash: computeCapsuleHash(hashInput),
    timestamp,
    seq: 0,
    external_processing: opts.external_processing ?? 'none',
    reciprocal_allowed: opts.reciprocal_allowed ?? false,
    tierSignals: sessionToTierSignals(session),
    wrdesk_policy_hash: computePolicyHash(policy),
    wrdesk_policy_version: policy.version,
  }
}

/**
 * Build an `accept` handshake capsule.
 *
 * Must be created by the party that received an `initiate` capsule.
 * `seq` is always `0` (independent accept chain).
 * `sharing_mode` is required.
 */
export function buildAcceptCapsule(
  session: SSOSession,
  opts: AcceptOptions,
): HandshakeCapsuleWire {
  const timestamp = opts.timestamp ?? new Date().toISOString()
  const relationship_id = deriveRelationshipId(session.wrdesk_user_id, opts.initiatorUserId)
  const policy = opts.policy ?? DEFAULT_POLICY_DESCRIPTOR

  const hashInput: CapsuleHashInput = {
    capsule_type: 'accept',
    handshake_id: opts.handshake_id,
    relationship_id,
    schema_version: 1,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    seq: 0,
    timestamp,
    sharing_mode: opts.sharing_mode,
    wrdesk_policy_hash: computePolicyHash(policy),
    wrdesk_policy_version: policy.version,
  }

  const reciprocal_allowed = opts.sharing_mode === 'reciprocal'
    ? (opts.reciprocal_allowed ?? true)
    : (opts.reciprocal_allowed ?? false)

  return {
    schema_version: 1,
    capsule_type: 'accept',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    senderIdentity: {
      email: session.email,
      iss: session.iss,
      sub: session.sub,
      email_verified: true,
      wrdesk_user_id: session.wrdesk_user_id,
    },
    capsule_hash: computeCapsuleHash(hashInput),
    timestamp,
    seq: 0,
    sharing_mode: opts.sharing_mode,
    external_processing: opts.external_processing ?? 'none',
    reciprocal_allowed,
    tierSignals: sessionToTierSignals(session),
    wrdesk_policy_hash: computePolicyHash(policy),
    wrdesk_policy_version: policy.version,
  }
}

/**
 * Build a `refresh` handshake capsule.
 *
 * Requires chain state from the stored HandshakeRecord:
 *   - `last_seq_received` — the pipeline will expect seq = last_seq_received + 1
 *   - `last_capsule_hash_received` — used as `prev_hash`
 */
export function buildRefreshCapsule(
  session: SSOSession,
  opts: RefreshOptions,
): HandshakeCapsuleWire {
  const timestamp = opts.timestamp ?? new Date().toISOString()
  const relationship_id = deriveRelationshipId(session.wrdesk_user_id, opts.counterpartyUserId)
  const policy = opts.policy ?? DEFAULT_POLICY_DESCRIPTOR
  const seq = opts.last_seq_received + 1

  const hashInput: CapsuleHashInput = {
    capsule_type: 'refresh',
    handshake_id: opts.handshake_id,
    relationship_id,
    schema_version: 1,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    seq,
    timestamp,
    prev_hash: opts.last_capsule_hash_received,
    wrdesk_policy_hash: computePolicyHash(policy),
    wrdesk_policy_version: policy.version,
  }

  const wire: HandshakeCapsuleWire = {
    schema_version: 1,
    capsule_type: 'refresh',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    senderIdentity: {
      email: session.email,
      iss: session.iss,
      sub: session.sub,
      email_verified: true,
      wrdesk_user_id: session.wrdesk_user_id,
    },
    capsule_hash: computeCapsuleHash(hashInput),
    timestamp,
    seq,
    prev_hash: opts.last_capsule_hash_received,
    external_processing: 'none',
    reciprocal_allowed: false,
    tierSignals: sessionToTierSignals(session),
    wrdesk_policy_hash: computePolicyHash(policy),
    wrdesk_policy_version: policy.version,
    ...(opts.context_blocks && opts.context_blocks.length > 0
      ? { context_blocks: opts.context_blocks }
      : {}),
  }
  return wire
}

/**
 * Build a `revoke` handshake capsule.
 *
 * Requires chain state from the stored HandshakeRecord for seq continuity.
 * Note: `prev_hash` and `wrdesk_policy_hash` are NOT required for revoke
 * (Validator step 5 only requires handshake_id, sender_id, capsule_hash, timestamp).
 */
export function buildRevokeCapsule(
  session: SSOSession,
  opts: RevokeOptions,
): HandshakeCapsuleWire {
  const timestamp = opts.timestamp ?? new Date().toISOString()
  const relationship_id = deriveRelationshipId(session.wrdesk_user_id, opts.counterpartyUserId)
  const seq = opts.last_seq_received + 1

  const hashInput: CapsuleHashInput = {
    capsule_type: 'revoke',
    handshake_id: opts.handshake_id,
    relationship_id,
    schema_version: 1,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    seq,
    timestamp,
  }

  return {
    schema_version: 1,
    capsule_type: 'revoke',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    senderIdentity: {
      email: session.email,
      iss: session.iss,
      sub: session.sub,
      email_verified: true,
      wrdesk_user_id: session.wrdesk_user_id,
    },
    capsule_hash: computeCapsuleHash(hashInput),
    timestamp,
    seq,
    external_processing: 'none',
    reciprocal_allowed: false,
    tierSignals: sessionToTierSignals(session),
    wrdesk_policy_hash: '',
    wrdesk_policy_version: '',
  }
}

// ── Helpers ──

function sessionToTierSignals(session: SSOSession): TierSignals {
  return {
    plan: session.plan,
    hardwareAttestation: session.currentHardwareAttestation,
    dnsVerification: session.currentDnsVerification,
    wrStampStatus: session.currentWrStampStatus,
  }
}
