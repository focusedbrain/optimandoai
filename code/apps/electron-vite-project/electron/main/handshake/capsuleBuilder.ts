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
 *   - schema_version is always 2
 *   - seq is always 0 for initiate and accept (independent chains)
 *   - seq for refresh/revoke/context_sync (post-accept) is nextOutboundHandshakeSeq
 *     (max(last_seq_sent, last_seq_received) + 1) so a local send cannot reuse seq
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
import type { SSOSession, SharingMode, TierSignals, ReceiverIdentity } from './types'
import type { ContextBlockProof } from './canonicalRebuild'
import { computeCapsuleHash, type CapsuleHashInput } from './capsuleHash'
import { computeContextHash, generateNonce, type ContextHashInput } from './contextHash'
import { computeContextCommitment, stripContentFromBlocks, type ContextBlockForCommitment, type ContextBlockWireProof } from './contextCommitment'
import { computePolicyHash, DEFAULT_POLICY_DESCRIPTOR, type PolicyDescriptor } from './policyHash'
import { deriveRelationshipId } from './relationshipId'
import { generateSigningKeypair, signCapsuleHash, type SigningKeypair } from './signatureKeys'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { INTERNAL_ENDPOINT_ERROR_CODES } from '../../../../../packages/shared/src/handshake/internalEndpointValidation'

// ── Wire format types ──

/**
 * Thrown when an internal relay-eligible capsule cannot be built with required device identity.
 * Wire fields are excluded from capsule_hash / context_hash; this does not affect signing inputs.
 */
export class InternalCapsuleRelayIdentityError extends Error {
  readonly code = INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_CAPSULE_MISSING_DEVICE_ID
  constructor(message: string) {
    super(`${INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_CAPSULE_MISSING_DEVICE_ID}: ${message}`)
    this.name = 'InternalCapsuleRelayIdentityError'
  }
}

/**
 * Merge internal / same-principal relay fields onto the wire envelope.
 * These fields are not part of {@link computeCapsuleHash} or {@link computeContextHash}.
 */
function mergeInternalRelayWireFields(opts: {
  isInternalHandshake?: boolean
  coordinationSenderDeviceId?: string
  coordinationReceiverDeviceId?: string
  senderDeviceRole?: 'host' | 'sandbox'
  receiverDeviceRole?: 'host' | 'sandbox'
  senderComputerName?: string
  receiverComputerName?: string
}): Partial<HandshakeCapsuleWire> {
  const s = opts.coordinationSenderDeviceId?.trim()
  const r = opts.coordinationReceiverDeviceId?.trim()

  if (opts.isInternalHandshake) {
    // accept/refresh/revoke/context_sync paths still need both device ids — they're
    // sent over the coordination relay using the legacy ID-based routing. Only the
    // initiate path was rewritten to pairing-code routing (handled in
    // mergeInternalInitiateWireFields below).
    if (!s || !r) {
      throw new InternalCapsuleRelayIdentityError(
        'internal handshake capsule requires coordinationSenderDeviceId and coordinationReceiverDeviceId',
      )
    }
    if (s === r) {
      throw new InternalCapsuleRelayIdentityError(
        'sender_device_id and receiver_device_id must differ for internal relay capsules',
      )
    }
    if (!opts.senderDeviceRole || !opts.receiverDeviceRole) {
      throw new InternalCapsuleRelayIdentityError(
        'internal relay capsule requires sender_device_role and receiver_device_role',
      )
    }
    const sname = opts.senderComputerName?.trim()
    const rname = opts.receiverComputerName?.trim()
    if (!sname || !rname) {
      throw new InternalCapsuleRelayIdentityError(
        'internal relay capsule requires sender_computer_name and receiver_computer_name',
      )
    }
    return {
      handshake_type: 'internal',
      sender_device_id: s,
      receiver_device_id: r,
      sender_device_role: opts.senderDeviceRole,
      receiver_device_role: opts.receiverDeviceRole,
      sender_computer_name: sname,
      receiver_computer_name: rname,
    }
  }

  if (s && r && s !== r) {
    return {
      handshake_type: 'internal',
      sender_device_id: s,
      receiver_device_id: r,
      ...(opts.senderDeviceRole ? { sender_device_role: opts.senderDeviceRole } : {}),
      ...(opts.receiverDeviceRole ? { receiver_device_role: opts.receiverDeviceRole } : {}),
      ...(opts.senderComputerName?.trim()
        ? { sender_computer_name: opts.senderComputerName.trim() }
        : {}),
      ...(opts.receiverComputerName?.trim()
        ? { receiver_computer_name: opts.receiverComputerName.trim() }
        : {}),
    }
  }
  return {}
}

/**
 * Pairing-code-based internal initiate wire. Sender device fields (id, role, computer name)
 * still travel on the wire because the relay routes by sender_device_id + recipient email
 * exactly like external handshakes. The peer is identified solely by `receiver_pairing_code`,
 * which is verified at acceptance time on the receiver's device. The full
 * `receiver_device_id` UUID is no longer required for new internal initiate capsules.
 *
 * `receiver_pairing_code` is intentionally NOT included in `capsule_hash` /
 * `context_hash` inputs — adding it would break legacy capsules and falsely tie
 * the signed identity of the capsule to a routing artefact.
 */
function mergeInternalInitiatePairingWireFields(opts: {
  coordinationSenderDeviceId?: string
  senderDeviceRole?: 'host' | 'sandbox'
  senderComputerName?: string
  receiverPairingCode?: string
}): Partial<HandshakeCapsuleWire> {
  const s = opts.coordinationSenderDeviceId?.trim()
  const code = opts.receiverPairingCode?.trim()
  if (!s) {
    throw new InternalCapsuleRelayIdentityError(
      'internal initiate capsule requires sender_device_id (local orchestrator instance id)',
    )
  }
  if (!code || !/^\d{6}$/.test(code)) {
    throw new InternalCapsuleRelayIdentityError(
      'internal initiate capsule requires a 6-digit receiver_pairing_code',
    )
  }
  if (!opts.senderDeviceRole) {
    throw new InternalCapsuleRelayIdentityError(
      'internal initiate capsule requires sender_device_role',
    )
  }
  const sname = opts.senderComputerName?.trim()
  if (!sname) {
    throw new InternalCapsuleRelayIdentityError(
      'internal initiate capsule requires sender_computer_name',
    )
  }
  return {
    handshake_type: 'internal',
    sender_device_id: s,
    sender_device_role: opts.senderDeviceRole,
    sender_computer_name: sname,
    receiver_pairing_code: code,
  }
}

export interface HandshakeCapsuleWire {
  readonly schema_version: 2;
  readonly capsule_type: 'initiate' | 'accept' | 'refresh' | 'revoke' | 'context_sync';
  readonly handshake_id: string;
  readonly relationship_id: string;
  readonly sender_id: string;
  readonly sender_wrdesk_user_id: string;
  readonly sender_email: string;
  readonly receiver_id: string;
  readonly receiver_email: string;
  readonly senderIdentity: {
    readonly email: string;
    readonly iss: string;
    readonly sub: string;
    readonly email_verified: true;
    readonly wrdesk_user_id: string;
  };
  readonly receiverIdentity: ReceiverIdentity | null;
  readonly capsule_hash: string;
  readonly context_hash: string;
  readonly context_commitment: string | null;
  readonly nonce: string;
  readonly timestamp: string;
  readonly seq: number;
  readonly external_processing: 'none' | 'local_only';
  readonly reciprocal_allowed: boolean;
  readonly tierSignals: TierSignals;
  readonly wrdesk_policy_hash: string;
  readonly wrdesk_policy_version: string;
  readonly sharing_mode?: SharingMode;
  readonly prev_hash?: string;
  readonly context_block_proofs?: ReadonlyArray<ContextBlockProof>;
  readonly context_blocks: ReadonlyArray<ContextBlockWireProof>;
  /** Sender's P2P endpoint (advertised in initiate/accept). Optional. */
  readonly p2p_endpoint?: string | null;
  /** Ed25519 public key (64-char hex) — sender's signing key */
  readonly sender_public_key: string;
  /** Ed25519 signature (128-char hex) over capsule_hash */
  readonly sender_signature: string;
  /** On accept only: acceptor's signature over initiator's capsule_hash (128-char hex) */
  readonly countersigned_hash?: string;
  /** X25519 public key (base64, 32 bytes) for qBEAP key agreement */
  readonly sender_x25519_public_key_b64?: string;
  /** ML-KEM-768 public key (base64, 1184 bytes) for post-quantum key agreement */
  readonly sender_mlkem768_public_key_b64?: string;
  /**
   * Orchestrator instance id (same as coordination WS device_id). Not included in capsule_hash;
   * used so the acceptor can register both relay routing ids for internal (same-user) handshakes.
   */
  readonly sender_device_id?: string;
  /** Internal handshakes only — sender endpoint metadata (not in capsule_hash). */
  readonly handshake_type?: 'internal' | 'standard';
  readonly sender_device_role?: 'host' | 'sandbox';
  readonly sender_computer_name?: string;
  /** Internal initiate / relay: intended receiver device (peer). Not in capsule_hash. */
  readonly receiver_device_id?: string;
  readonly receiver_device_role?: 'host' | 'sandbox';
  readonly receiver_computer_name?: string;
  /**
   * Internal initiate ONLY — 6-digit decimal pairing code (no dash) of the intended
   * receiver device. Sole peer identifier for new internal initiate capsules:
   * verified at acceptance time by string-equality with the receiver's own pairing
   * code from `orchestratorModeStore.getPairingCode()`. Not part of `capsule_hash`
   * or `context_hash` inputs (metadata only). Mutually exclusive in practice with
   * `receiver_device_id` for new internal initiate capsules; legacy capsules carry
   * `receiver_device_id` instead.
   */
  readonly receiver_pairing_code?: string;
}

// ── Options types ──

export interface InitiateOptions {
  /** ID of the party being invited (receiver's wrdesk_user_id) */
  receiverUserId: string;
  /** Email of the party being invited */
  receiverEmail: string;
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
  /** Explicit nonce override (generated if absent) — for testing only */
  nonce?: string;
  /** Context blocks to attach to the initiate capsule */
  context_blocks?: ContextBlockForCommitment[];
  /** Sender's P2P endpoint for context-sync delivery (e.g. https://host:port/beap/ingest). Null if not configured. */
  p2p_endpoint?: string | null;
  /** Sender's P2P auth token (Bearer) for authenticating requests to our /beap/ingest. 32 bytes hex. */
  p2p_auth_token?: string | null;
  /** X25519 public key (base64) for qBEAP key agreement. From extension getDeviceX25519PublicKey or generated. */
  sender_x25519_public_key_b64?: string | null;
  /** ML-KEM-768 public key (base64) for post-quantum key agreement. Generated or from caller. */
  sender_mlkem768_public_key_b64?: string | null;
  /** Internal: this device's role. */
  initiatorDeviceRole?: 'host' | 'sandbox';
  /** Internal: this device's computer name. */
  initiatorComputerName?: string;
  /**
   * Internal initiate (pairing-code routing): the 6-digit pairing code of the intended
   * receiver device, as typed by the user. This is the sole peer identifier for new
   * internal initiate capsules and replaces `internalEndpointPeer.deviceId`.
   */
  internalReceiverPairingCode?: string;
}

/** Result of buildInitiateCapsuleWithContent including keypair for persistence */
export interface InitiateBuildResult {
  capsule: HandshakeCapsuleWire
  localBlocks: ContextBlockForCommitment[]
  keypair: SigningKeypair
}

export interface AcceptOptions {
  /** The handshake_id from the initiate capsule received */
  handshake_id: string;
  /** The initiator's wrdesk_user_id (from the received initiate capsule) */
  initiatorUserId: string;
  /** The initiator's email (from the received initiate capsule) */
  initiatorEmail: string;
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
  /** Explicit nonce override (generated if absent) — for testing only */
  nonce?: string;
  /** Context blocks echoed from the initiate capsule (for commitment binding) */
  context_blocks?: ContextBlockForCommitment[];
  /** Context commitment from the initiate capsule */
  context_commitment?: string | null;
  /** Sender's P2P endpoint for context-sync delivery (e.g. https://host:port/beap/ingest). Null if not configured. */
  p2p_endpoint?: string | null;
  /** Sender's P2P auth token (Bearer) for authenticating requests to our /beap/ingest. 32 bytes hex. */
  p2p_auth_token?: string | null;
  /** Initiator's capsule_hash (from received initiate) — required for countersignature */
  initiator_capsule_hash?: string;
  /** X25519 public key (base64) for qBEAP key agreement. From extension getDeviceX25519PublicKey or generated. */
  sender_x25519_public_key_b64?: string | null;
  /** ML-KEM-768 public key (base64) for post-quantum key agreement. Generated or from caller. */
  sender_mlkem768_public_key_b64?: string | null;
  /** Initiator's coordination device id (internal accept only). */
  initiatorCoordinationDeviceId?: string;
  /** When true, attach coordination routing ids for same-principal relay. */
  isInternalHandshake?: boolean;
  /** Internal accept: wire sender_* (local acceptor). Required with isInternalHandshake. */
  senderDeviceRole?: 'host' | 'sandbox';
  senderComputerName?: string;
  /** Internal accept: wire receiver_* (initiator peer). Required with isInternalHandshake. */
  receiverDeviceRole?: 'host' | 'sandbox';
  receiverComputerName?: string;
}

/**
 * Monotonic next seq for our outbound post-accept capsules, shared by context_sync, refresh, and revoke.
 * `last_seq_sent` is the highest seq we have already enqueued from this side; it must be included when
 * it can exceed `last_seq_received` (e.g. after we sent context_sync with seq 1 while still having
 * `last_seq_received === 0`).
 */
export function nextOutboundHandshakeSeq(params: {
  last_seq_sent?: number
  last_seq_received: number
}): number {
  const sent = params.last_seq_sent ?? 0
  const rec = params.last_seq_received
  return Math.max(sent, rec) + 1
}

export interface RefreshOptions {
  /** The handshake_id of the active handshake */
  handshake_id: string;
  /** The counterparty's wrdesk_user_id */
  counterpartyUserId: string;
  /** The counterparty's email */
  counterpartyEmail: string;
  /** The highest seq we have already sent on this handshake (outbound); omit if 0 */
  last_seq_sent?: number;
  /** The seq of the last capsule received FROM the counterparty */
  last_seq_received: number;
  /** The hash of the last capsule received FROM the counterparty */
  last_capsule_hash_received: string;
  /** Cryptographic proofs (hashes) of context blocks — never raw content */
  context_block_proofs?: ReadonlyArray<ContextBlockProof>;
  /** Context blocks to attach (carries content + commitment hash) */
  context_blocks?: ContextBlockForCommitment[];
  /** Policy descriptor to anchor. Defaults to DEFAULT_POLICY_DESCRIPTOR. */
  policy?: PolicyDescriptor;
  /** Explicit timestamp override */
  timestamp?: string;
  /** Explicit nonce override (generated if absent) — for testing only */
  nonce?: string;
  /** Sender's public key (64-char hex) — required for refresh. From handshake record. */
  local_public_key: string;
  /** Sender's private key (64-char hex) for signing — required for refresh. From handshake record. */
  local_private_key: string;
  /** Same-principal relay: local and peer coordination device ids. */
  coordinationSenderDeviceId?: string;
  coordinationReceiverDeviceId?: string;
  /** When true, require full internal relay wire (ids + roles + computer names). */
  isInternalHandshake?: boolean;
  senderDeviceRole?: 'host' | 'sandbox';
  receiverDeviceRole?: 'host' | 'sandbox';
  senderComputerName?: string;
  receiverComputerName?: string;
}

export interface RevokeOptions {
  /** The handshake_id of the handshake to revoke */
  handshake_id: string;
  /** The counterparty's wrdesk_user_id */
  counterpartyUserId: string;
  /** The counterparty's email */
  counterpartyEmail: string;
  /** The highest seq we have already sent on this handshake; omit if 0 */
  last_seq_sent?: number;
  /** The seq of the last capsule received FROM the counterparty */
  last_seq_received: number;
  /** The hash of the last capsule received FROM the counterparty */
  last_capsule_hash_received: string;
  /** Explicit timestamp override */
  timestamp?: string;
  /** Explicit nonce override (generated if absent) — for testing only */
  nonce?: string;
  /** Sender's public key (64-char hex) — required for revoke */
  local_public_key: string;
  /** Sender's private key (64-char hex) for signing — required for revoke */
  local_private_key: string;
  coordinationSenderDeviceId?: string;
  coordinationReceiverDeviceId?: string;
  isInternalHandshake?: boolean;
  senderDeviceRole?: 'host' | 'sandbox';
  receiverDeviceRole?: 'host' | 'sandbox';
  senderComputerName?: string;
  receiverComputerName?: string;
}

/** Options for context_sync — first post-activation capsule delivering context blocks. */
export interface ContextSyncOptions {
  /** The handshake_id of the active handshake */
  handshake_id: string;
  /** The counterparty's wrdesk_user_id */
  counterpartyUserId: string;
  /** The counterparty's email */
  counterpartyEmail: string;
  /** The highest seq we have already sent on this handshake; omit if 0 */
  last_seq_sent?: number;
  /** Last seq received from the counterparty (0 after accept) */
  last_seq_received: number;
  /** The hash of the accept capsule received */
  last_capsule_hash_received: string;
  /** Context blocks to deliver (may be empty for minimal sync) */
  context_blocks?: ContextBlockForCommitment[];
  /** Policy descriptor to anchor. Defaults to DEFAULT_POLICY_DESCRIPTOR. */
  policy?: PolicyDescriptor;
  /** Explicit timestamp override */
  timestamp?: string;
  /** Explicit nonce override (generated if absent) — for testing only */
  nonce?: string;
  /** Sender's public key (64-char hex) — required for context_sync */
  local_public_key: string;
  /** Sender's private key (64-char hex) for signing — required for context_sync */
  local_private_key: string;
  coordinationSenderDeviceId?: string;
  coordinationReceiverDeviceId?: string;
  isInternalHandshake?: boolean;
  senderDeviceRole?: 'host' | 'sandbox';
  receiverDeviceRole?: 'host' | 'sandbox';
  senderComputerName?: string;
  receiverComputerName?: string;
}

// ── Builder functions ──

/**
 * Build an `initiate` handshake capsule (internal — returns capsule + keypair).
 */
function buildInitiateCapsuleCore(
  session: SSOSession,
  opts: InitiateOptions,
): { capsule: HandshakeCapsuleWire; keypair: SigningKeypair } {
  const timestamp = opts.timestamp ?? new Date().toISOString()
  const handshake_id = opts.handshake_id ?? `hs-${randomUUID()}`
  const relationship_id = deriveRelationshipId(
    session.wrdesk_user_id,
    opts.receiverUserId,
    session.wrdesk_user_id === opts.receiverUserId ? handshake_id : undefined,
  )
  const policy = opts.policy ?? DEFAULT_POLICY_DESCRIPTOR
  const nonce = opts.nonce ?? generateNonce()
  const policyHash = computePolicyHash(policy)
  const canonicalBlocks = canonicalizeBlockIds(opts.context_blocks, handshake_id)
  const contextCommitment = computeContextCommitment(canonicalBlocks)

  const hashInput: CapsuleHashInput = {
    capsule_type: 'initiate',
    handshake_id,
    relationship_id,
    schema_version: 2,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    receiver_email: opts.receiverEmail,
    seq: 0,
    timestamp,
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    context_commitment: contextCommitment,
  }

  const contextHashInput: ContextHashInput = {
    schema_version: 2,
    capsule_type: 'initiate',
    handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    sender_email: session.email,
    receiver_id: opts.receiverUserId,
    receiver_email: opts.receiverEmail,
    timestamp,
    nonce,
    seq: 0,
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
  }

  const capsuleHash = computeCapsuleHash(hashInput)
  const keypair = generateSigningKeypair()
  const senderSignature = signCapsuleHash(capsuleHash, keypair.privateKey)

  let coordinationDeviceId: string | undefined
  try {
    coordinationDeviceId = getInstanceId()?.trim() || undefined
  } catch {
    coordinationDeviceId = undefined
  }

  let internalWire: Partial<HandshakeCapsuleWire> = {}
  if (opts.internalReceiverPairingCode) {
    internalWire = mergeInternalInitiatePairingWireFields({
      coordinationSenderDeviceId: coordinationDeviceId,
      senderDeviceRole: opts.initiatorDeviceRole,
      senderComputerName: opts.initiatorComputerName,
      receiverPairingCode: opts.internalReceiverPairingCode,
    })
  } else if (coordinationDeviceId) {
    internalWire = { sender_device_id: coordinationDeviceId }
  }

  const capsule: HandshakeCapsuleWire = {
    schema_version: 2,
    capsule_type: 'initiate',
    handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    sender_email: session.email,
    receiver_id: opts.receiverUserId,
    receiver_email: opts.receiverEmail,
    senderIdentity: {
      email: session.email,
      iss: session.iss,
      sub: session.sub,
      email_verified: true,
      wrdesk_user_id: session.wrdesk_user_id,
    },
    receiverIdentity: null,
    capsule_hash: capsuleHash,
    context_hash: computeContextHash(contextHashInput),
    context_commitment: contextCommitment,
    nonce,
    timestamp,
    seq: 0,
    external_processing: opts.external_processing ?? 'none',
    reciprocal_allowed: opts.reciprocal_allowed ?? true,
    tierSignals: sessionToTierSignals(session),
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    context_blocks: canonicalBlocks ? stripContentFromBlocks(canonicalBlocks) : [],
    sender_public_key: keypair.publicKey,
    sender_signature: senderSignature,
    ...(opts.p2p_endpoint ? { p2p_endpoint: opts.p2p_endpoint } : {}),
    ...(opts.p2p_auth_token ? { p2p_auth_token: opts.p2p_auth_token } : {}),
    ...(opts.sender_x25519_public_key_b64 ? { sender_x25519_public_key_b64: opts.sender_x25519_public_key_b64 } : {}),
    ...(opts.sender_mlkem768_public_key_b64 ? { sender_mlkem768_public_key_b64: opts.sender_mlkem768_public_key_b64 } : {}),
    ...internalWire,
  }
  return { capsule, keypair }
}

/**
 * Build an `initiate` handshake capsule.
 * The sender is identified by `session.wrdesk_user_id`.
 * `seq` is always `0` (first capsule in the initiate chain).
 */
export function buildInitiateCapsule(
  session: SSOSession,
  opts: InitiateOptions,
): HandshakeCapsuleWire {
  return buildInitiateCapsuleCore(session, opts).capsule
}

/** Build initiate capsule and return keypair (for tests that need keys for context_sync). */
export function buildInitiateCapsuleWithKeypair(
  session: SSOSession,
  opts: InitiateOptions,
): { capsule: HandshakeCapsuleWire; keypair: SigningKeypair } {
  return buildInitiateCapsuleCore(session, opts)
}

/**
 * Build an `accept` handshake capsule.
 * Must be created by the party that received an `initiate` capsule.
 * `seq` is always `0` (independent accept chain). `sharing_mode` is required.
 * Returns capsule + keypair for persistence.
 */
export function buildAcceptCapsule(
  session: SSOSession,
  opts: AcceptOptions,
): AcceptBuildResult {
  const timestamp = opts.timestamp ?? new Date().toISOString()
  const relationship_id = deriveRelationshipId(
    session.wrdesk_user_id,
    opts.initiatorUserId,
    session.wrdesk_user_id === opts.initiatorUserId ? opts.handshake_id : undefined,
  )
  const policy = opts.policy ?? DEFAULT_POLICY_DESCRIPTOR
  const nonce = opts.nonce ?? generateNonce()
  const policyHash = computePolicyHash(policy)

  const receiverIdentity: ReceiverIdentity = {
    email: session.email,
    iss: session.iss,
    sub: session.sub,
    email_verified: true,
    wrdesk_user_id: session.wrdesk_user_id,
  }

  const acceptContextCommitment = opts.context_commitment ?? null

  const hashInput: CapsuleHashInput = {
    capsule_type: 'accept',
    handshake_id: opts.handshake_id,
    relationship_id,
    schema_version: 2,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    receiver_email: opts.initiatorEmail,
    seq: 0,
    timestamp,
    sharing_mode: opts.sharing_mode,
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    context_commitment: acceptContextCommitment,
    senderIdentity_sub: session.sub,
    receiverIdentity_sub: session.sub,
  }

  const contextHashInput: ContextHashInput = {
    schema_version: 2,
    capsule_type: 'accept',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    sender_email: session.email,
    receiver_id: opts.initiatorUserId,
    receiver_email: opts.initiatorEmail,
    timestamp,
    nonce,
    seq: 0,
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    sharing_mode: opts.sharing_mode,
  }

  const reciprocal_allowed = opts.sharing_mode === 'reciprocal'
    ? (opts.reciprocal_allowed ?? true)
    : (opts.reciprocal_allowed ?? false)

  const capsuleHash = computeCapsuleHash(hashInput)
  const keypair = generateSigningKeypair()
  const senderSignature = signCapsuleHash(capsuleHash, keypair.privateKey)
  const initiatorCapsuleHash = opts.initiator_capsule_hash ?? ''
  const countersignedHash =
    initiatorCapsuleHash && /^[a-f0-9]{64}$/i.test(initiatorCapsuleHash)
      ? signCapsuleHash(initiatorCapsuleHash, keypair.privateKey)
      : undefined

  if (!opts.sender_x25519_public_key_b64?.trim()) {
    console.error('[CAPSULE-BUILD] WARNING: accept capsule missing X25519 public key!', {
      handshake_id: opts.handshake_id,
    })
  }
  if (!opts.sender_mlkem768_public_key_b64?.trim()) {
    console.error('[CAPSULE-BUILD] WARNING: accept capsule missing ML-KEM public key!', {
      handshake_id: opts.handshake_id,
    })
  }

  let acceptCoordinationDeviceId: string | undefined
  try {
    acceptCoordinationDeviceId = getInstanceId()?.trim() || undefined
  } catch {
    acceptCoordinationDeviceId = undefined
  }
  const internalCoord: Partial<HandshakeCapsuleWire> = opts.isInternalHandshake
    ? mergeInternalRelayWireFields({
        isInternalHandshake: true,
        coordinationSenderDeviceId: acceptCoordinationDeviceId,
        coordinationReceiverDeviceId: opts.initiatorCoordinationDeviceId?.trim(),
        senderDeviceRole: opts.senderDeviceRole,
        receiverDeviceRole: opts.receiverDeviceRole,
        senderComputerName: opts.senderComputerName,
        receiverComputerName: opts.receiverComputerName,
      })
    : {}

  const capsule: HandshakeCapsuleWire = {
    schema_version: 2,
    capsule_type: 'accept',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    sender_email: session.email,
    receiver_id: opts.initiatorUserId,
    receiver_email: opts.initiatorEmail,
    senderIdentity: {
      email: session.email,
      iss: session.iss,
      sub: session.sub,
      email_verified: true,
      wrdesk_user_id: session.wrdesk_user_id,
    },
    receiverIdentity: receiverIdentity,
    capsule_hash: capsuleHash,
    context_hash: computeContextHash(contextHashInput),
    context_commitment: acceptContextCommitment,
    nonce,
    timestamp,
    seq: 0,
    sharing_mode: opts.sharing_mode,
    external_processing: opts.external_processing ?? 'none',
    reciprocal_allowed,
    tierSignals: sessionToTierSignals(session),
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    context_blocks: opts.context_blocks ? stripContentFromBlocks(opts.context_blocks) : [],
    sender_public_key: keypair.publicKey,
    sender_signature: senderSignature,
    ...(countersignedHash ? { countersigned_hash: countersignedHash } : {}),
    ...(opts.p2p_endpoint ? { p2p_endpoint: opts.p2p_endpoint } : {}),
    ...(opts.p2p_auth_token ? { p2p_auth_token: opts.p2p_auth_token } : {}),
    ...(opts.sender_x25519_public_key_b64 ? { sender_x25519_public_key_b64: opts.sender_x25519_public_key_b64 } : {}),
    ...(opts.sender_mlkem768_public_key_b64 ? { sender_mlkem768_public_key_b64: opts.sender_mlkem768_public_key_b64 } : {}),
    ...internalCoord,
  }
  return { capsule, keypair }
}

/** Result of buildAcceptCapsule including keypair for persistence (same shape for accept) */
export interface AcceptBuildResult {
  capsule: HandshakeCapsuleWire
  keypair: SigningKeypair
}

/**
 * Build a `refresh` handshake capsule.
 *
 * Requires chain state from the stored HandshakeRecord:
 *   - `last_seq_sent` / `last_seq_received` — seq = nextOutboundHandshakeSeq(…)
 *   - `last_capsule_hash_received` — used as `prev_hash`
 */
export function buildRefreshCapsule(
  session: SSOSession,
  opts: RefreshOptions,
): HandshakeCapsuleWire {
  const timestamp = opts.timestamp ?? new Date().toISOString()
  const relationship_id = deriveRelationshipId(
    session.wrdesk_user_id,
    opts.counterpartyUserId,
    session.wrdesk_user_id === opts.counterpartyUserId ? opts.handshake_id : undefined,
  )
  const policy = opts.policy ?? DEFAULT_POLICY_DESCRIPTOR
  const seq = nextOutboundHandshakeSeq({
    last_seq_sent: opts.last_seq_sent,
    last_seq_received: opts.last_seq_received,
  })
  const nonce = opts.nonce ?? generateNonce()
  const policyHash = computePolicyHash(policy)
  const refreshCanonicalBlocks = canonicalizeBlockIds(opts.context_blocks, opts.handshake_id)
  const contextCommitment = computeContextCommitment(refreshCanonicalBlocks)

  const hashInput: CapsuleHashInput = {
    capsule_type: 'refresh',
    handshake_id: opts.handshake_id,
    relationship_id,
    schema_version: 2,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    receiver_email: opts.counterpartyEmail,
    seq,
    timestamp,
    prev_hash: opts.last_capsule_hash_received,
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    context_commitment: contextCommitment,
  }

  const contextHashInput: ContextHashInput = {
    schema_version: 2,
    capsule_type: 'refresh',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    sender_email: session.email,
    receiver_id: opts.counterpartyUserId,
    receiver_email: opts.counterpartyEmail,
    timestamp,
    nonce,
    seq,
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    prev_hash: opts.last_capsule_hash_received,
  }

  const capsuleHash = computeCapsuleHash(hashInput)
  const senderSignature = signCapsuleHash(capsuleHash, opts.local_private_key)

  const wire: HandshakeCapsuleWire = {
    schema_version: 2,
    capsule_type: 'refresh',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    sender_email: session.email,
    receiver_id: opts.counterpartyUserId,
    receiver_email: opts.counterpartyEmail,
    senderIdentity: {
      email: session.email,
      iss: session.iss,
      sub: session.sub,
      email_verified: true,
      wrdesk_user_id: session.wrdesk_user_id,
    },
    receiverIdentity: null,
    capsule_hash: capsuleHash,
    context_hash: computeContextHash(contextHashInput),
    context_commitment: contextCommitment,
    nonce,
    timestamp,
    seq,
    prev_hash: opts.last_capsule_hash_received,
    external_processing: 'none',
    reciprocal_allowed: false,
    tierSignals: sessionToTierSignals(session),
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    sender_public_key: opts.local_public_key,
    sender_signature: senderSignature,
    ...(opts.context_block_proofs && opts.context_block_proofs.length > 0
      ? { context_block_proofs: opts.context_block_proofs }
      : {}),
    context_blocks: refreshCanonicalBlocks ? stripContentFromBlocks(refreshCanonicalBlocks) : [],
    ...mergeInternalRelayWireFields({
      isInternalHandshake: opts.isInternalHandshake,
      coordinationSenderDeviceId: opts.coordinationSenderDeviceId,
      coordinationReceiverDeviceId: opts.coordinationReceiverDeviceId,
      senderDeviceRole: opts.senderDeviceRole,
      receiverDeviceRole: opts.receiverDeviceRole,
      senderComputerName: opts.senderComputerName,
      receiverComputerName: opts.receiverComputerName,
    }),
  }
  return wire
}

/**
 * Build a `context_sync` handshake capsule.
 *
 * First post-activation capsule — MUST be sent when last_seq_received === 0.
 * Delivers context blocks to the counterparty. Uses same hash algorithm as refresh.
 */
export function buildContextSyncCapsule(
  session: SSOSession,
  opts: ContextSyncOptions,
): HandshakeCapsuleWire {
  const timestamp = opts.timestamp ?? new Date().toISOString()
  const relationship_id = deriveRelationshipId(
    session.wrdesk_user_id,
    opts.counterpartyUserId,
    session.wrdesk_user_id === opts.counterpartyUserId ? opts.handshake_id : undefined,
  )
  const policy = opts.policy ?? DEFAULT_POLICY_DESCRIPTOR
  const seq = nextOutboundHandshakeSeq({
    last_seq_sent: opts.last_seq_sent,
    last_seq_received: opts.last_seq_received,
  })
  const nonce = opts.nonce ?? generateNonce()
  const policyHash = computePolicyHash(policy)
  const canonicalBlocks = canonicalizeBlockIds(opts.context_blocks ?? [], opts.handshake_id)
  const contextCommitment = computeContextCommitment(canonicalBlocks)

  const hashInput: CapsuleHashInput = {
    capsule_type: 'refresh',
    handshake_id: opts.handshake_id,
    relationship_id,
    schema_version: 2,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    receiver_email: opts.counterpartyEmail,
    seq,
    timestamp,
    prev_hash: opts.last_capsule_hash_received,
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    context_commitment: contextCommitment,
  }

  const contextHashInput: ContextHashInput = {
    schema_version: 2,
    capsule_type: 'refresh',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    sender_email: session.email,
    receiver_id: opts.counterpartyUserId,
    receiver_email: opts.counterpartyEmail,
    timestamp,
    nonce,
    seq,
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    prev_hash: opts.last_capsule_hash_received,
  }

  const capsuleHash = computeCapsuleHash(hashInput)
  const senderSignature = signCapsuleHash(capsuleHash, opts.local_private_key)

  return {
    schema_version: 2,
    capsule_type: 'context_sync',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    sender_email: session.email,
    receiver_id: opts.counterpartyUserId,
    receiver_email: opts.counterpartyEmail,
    senderIdentity: {
      email: session.email,
      iss: session.iss,
      sub: session.sub,
      email_verified: true,
      wrdesk_user_id: session.wrdesk_user_id,
    },
    receiverIdentity: null,
    capsule_hash: capsuleHash,
    context_hash: computeContextHash(contextHashInput),
    context_commitment: contextCommitment,
    nonce,
    timestamp,
    seq,
    prev_hash: opts.last_capsule_hash_received,
    external_processing: 'none',
    reciprocal_allowed: false,
    tierSignals: sessionToTierSignals(session),
    wrdesk_policy_hash: policyHash,
    wrdesk_policy_version: policy.version,
    sender_public_key: opts.local_public_key,
    sender_signature: senderSignature,
    context_blocks: canonicalBlocks ? stripContentFromBlocks(canonicalBlocks) : [],
    ...mergeInternalRelayWireFields({
      isInternalHandshake: opts.isInternalHandshake,
      coordinationSenderDeviceId: opts.coordinationSenderDeviceId,
      coordinationReceiverDeviceId: opts.coordinationReceiverDeviceId,
      senderDeviceRole: opts.senderDeviceRole,
      receiverDeviceRole: opts.receiverDeviceRole,
      senderComputerName: opts.senderComputerName,
      receiverComputerName: opts.receiverComputerName,
    }),
  }
}

/**
 * Build a `context_sync` handshake capsule WITH content for P2P delivery.
 * Same as buildContextSyncCapsule but includes actual block content (no stripContentFromBlocks).
 * Use for automatic context-sync delivery after accept.
 */
export function buildContextSyncCapsuleWithContent(
  session: SSOSession,
  opts: ContextSyncOptions,
): HandshakeCapsuleWire & { context_blocks: ReadonlyArray<ContextBlockForCommitment> } {
  const base = buildContextSyncCapsule(session, opts)
  const canonicalBlocks = canonicalizeBlockIds(opts.context_blocks ?? [], opts.handshake_id)
  if (!canonicalBlocks || canonicalBlocks.length === 0) {
    return base as HandshakeCapsuleWire & { context_blocks: ReadonlyArray<ContextBlockForCommitment> }
  }
  const blocksWithContent = canonicalBlocks.map(b => ({
    block_id: b.block_id,
    block_hash: b.block_hash,
    type: b.type,
    scope_id: b.scope_id ?? null,
    content: b.content,
  }))
  return {
    ...base,
    context_blocks: blocksWithContent,
  } as HandshakeCapsuleWire & { context_blocks: ReadonlyArray<ContextBlockForCommitment> }
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
  const relationship_id = deriveRelationshipId(
    session.wrdesk_user_id,
    opts.counterpartyUserId,
    session.wrdesk_user_id === opts.counterpartyUserId ? opts.handshake_id : undefined,
  )
  const seq = nextOutboundHandshakeSeq({
    last_seq_sent: opts.last_seq_sent,
    last_seq_received: opts.last_seq_received,
  })
  const nonce = opts.nonce ?? generateNonce()

  const hashInput: CapsuleHashInput = {
    capsule_type: 'revoke',
    handshake_id: opts.handshake_id,
    relationship_id,
    schema_version: 2,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    receiver_email: opts.counterpartyEmail,
    seq,
    timestamp,
  }

  const capsuleHash = computeCapsuleHash(hashInput)
  const senderSignature = signCapsuleHash(capsuleHash, opts.local_private_key)

  const contextHashInput: ContextHashInput = {
    schema_version: 2,
    capsule_type: 'revoke',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    sender_email: session.email,
    receiver_id: opts.counterpartyUserId,
    receiver_email: opts.counterpartyEmail,
    timestamp,
    nonce,
    seq,
  }

  return {
    schema_version: 2,
    capsule_type: 'revoke',
    handshake_id: opts.handshake_id,
    relationship_id,
    sender_id: session.wrdesk_user_id,
    sender_wrdesk_user_id: session.wrdesk_user_id,
    sender_email: session.email,
    receiver_id: opts.counterpartyUserId,
    receiver_email: opts.counterpartyEmail,
    senderIdentity: {
      email: session.email,
      iss: session.iss,
      sub: session.sub,
      email_verified: true,
      wrdesk_user_id: session.wrdesk_user_id,
    },
    receiverIdentity: null,
    capsule_hash: capsuleHash,
    sender_public_key: opts.local_public_key,
    sender_signature: senderSignature,
    context_hash: computeContextHash(contextHashInput),
    context_commitment: null,
    nonce,
    timestamp,
    seq,
    external_processing: 'none',
    reciprocal_allowed: false,
    tierSignals: sessionToTierSignals(session),
    wrdesk_policy_hash: '',
    wrdesk_policy_version: '',
    context_blocks: [],
    ...mergeInternalRelayWireFields({
      isInternalHandshake: opts.isInternalHandshake,
      coordinationSenderDeviceId: opts.coordinationSenderDeviceId,
      coordinationReceiverDeviceId: opts.coordinationReceiverDeviceId,
      senderDeviceRole: opts.senderDeviceRole,
      receiverDeviceRole: opts.receiverDeviceRole,
      senderComputerName: opts.senderComputerName,
      receiverComputerName: opts.receiverComputerName,
    }),
  }
}

// ── Helpers ──

/**
 * Assign deterministic, handshake-scoped block_ids to context blocks.
 * Format: ctx-{handshake_id_short}-{NNN} where NNN is zero-padded index.
 */
function canonicalizeBlockIds(
  blocks: ContextBlockForCommitment[] | undefined,
  handshakeId: string,
): ContextBlockForCommitment[] | null {
  if (!blocks || blocks.length === 0) return null
  const shortId = handshakeId.replace(/^hs-/, '').slice(0, 8)
  return blocks.map((b, i) => ({
    ...b,
    block_id: `ctx-${shortId}-${String(i + 1).padStart(3, '0')}`,
  }))
}

/**
 * Build an initiate capsule and return both the wire capsule (no content),
 * the full context blocks (with content) for local storage, and the keypair for persistence.
 */
export function buildInitiateCapsuleWithContent(
  session: SSOSession,
  opts: InitiateOptions,
): InitiateBuildResult {
  const { capsule, keypair } = buildInitiateCapsuleCore(session, opts)
  const localBlocks = canonicalizeBlockIds(opts.context_blocks, capsule.handshake_id) ?? []
  return { capsule, localBlocks, keypair }
}

function sessionToTierSignals(session: SSOSession): TierSignals {
  return {
    plan: session.plan,
    hardwareAttestation: session.currentHardwareAttestation,
    dnsVerification: session.currentDnsVerification,
    wrStampStatus: session.currentWrStampStatus,
  }
}
