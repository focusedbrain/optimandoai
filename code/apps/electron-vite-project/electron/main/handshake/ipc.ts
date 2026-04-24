/**
 * Handshake IPC handlers for WebSocket RPC and HTTP routes.
 *
 * WebSocket RPC methods: handshake.*
 * HTTP routes: /api/handshake/*
 */

import type { HandshakeState, SSOSession, HandshakeRecord, BeapKeyAgreementMaterial } from './types'
import { x25519 } from '@noble/curves/ed25519'
import type { ContextBlockProof } from './canonicalRebuild'
import { ReasonCode, HandshakeState as HS } from './types'
// Context resolution imports removed — content enters only via the BEAP-Capsule pipeline
import {
  getHandshakeRecord,
  listHandshakeRecords,
  deleteHandshakeRecord,
  updateHandshakeSigningKeys,
  updateHandshakeRecord,
  refreshInternalHandshakePersistenceFlags,
  getPendingP2PBeapMessages,
  markP2PPendingBeapProcessed,
  getPendingPlainEmails,
  markPlainEmailProcessed,
} from './db'
import { isInternalCoordinationIdentityComplete } from './internalPersistence'
import { queryContextBlocks, queryContextBlocksWithGovernance } from './contextBlocks'
import { authorizeAction, diagnoseHandshakeInactive, isHandshakeActive } from './enforcement'
import { revokeHandshake } from './revocation'
import {
  buildInitiateCapsule,
  buildInitiateCapsuleWithContent,
  buildAcceptCapsule,
  buildRefreshCapsule,
  buildContextSyncCapsuleWithContent,
} from './capsuleBuilder'
import { submitCapsuleViaRpc } from './capsuleTransport'
import { persistInitiatorHandshakeRecord } from './initiatorPersist'
import { persistRecipientHandshakeRecord } from './recipientPersist'
import { sendCapsuleViaEmail } from './emailTransport'
import { computeBlockHash, type ContextBlockForCommitment } from './contextCommitment'
import {
  createDefaultGovernance,
  createMessageGovernance,
  baselineFromHandshake,
  baselineFromPolicySelections,
  filterBlocksForLocalAI,
  filterBlocksForCloudAI,
  filterBlocksForExport,
  filterBlocksForSearch,
  filterBlocksForPeerTransmission,
  filterBlocksForAutoReply,
  type ContextItemGovernance,
  type UsagePolicy,
} from './contextGovernance'
import {
  insertContextStoreEntry,
  getContextStoreByHandshake,
  updateContextStoreStatus,
  updateContextStoreStatusBulk,
  updateHandshakePolicySelections,
} from './db'
import { tryEnqueueContextSync, retryDeferredInitialContextSyncForInternalHandshake } from './contextSyncEnqueue'
import { deriveRelationshipId } from './relationshipId'
import { enqueueOutboundCapsule, processOutboundQueue, type ProcessOutboundQueueResult } from './outboundQueue'
import { randomBytes, randomUUID } from 'crypto'
import { getP2PConfig, getEffectiveRelayEndpoint } from '../p2p/p2pConfig'
import { registerHandshakeWithRelay } from '../p2p/relaySync'
import { processIncomingInput } from '../ingestion/ingestionPipeline'
import { replayBufferedContextSync } from '../p2p/coordinationWs'
import { canonicalRebuild } from './canonicalRebuild'
import { semanticSearch } from './embeddings'
import { validateReceiverEmail, isSameAccountHandshakeEmails } from '../../../../../packages/shared/src/handshake/receiverEmailValidation'
import {
  validateInternalEndpointFields,
  validateInternalEndpointPairDistinct,
  validateInternalInitiateContract,
  isValidPairingCodeFormat,
  normalizePairingCode,
  formatPairingCodeForDisplay,
  INTERNAL_ENDPOINT_ERROR_CODES as INTERNAL_ERROR_CODES,
} from '../../../../../packages/shared/src/handshake/internalEndpointValidation'
import {
  coordinationDevicePairForInternalRecord,
  internalRelayCapsuleWireOptsFromRecord,
} from './internalCoordinationWire'
import { formatLocalInternalRelayValidationJson } from './internalRelayOutboundGuards'
import {
  getInstanceId as getOrchestratorInstanceId,
  getPairingCode as getOrchestratorPairingCode,
} from '../orchestrator/orchestratorModeStore'

/** Coordination registry must use JWT `sub` for both parties when the handshake is same-account, or same-user device routing never engages. */
function coordinationAcceptorUserIdForRegistration(
  session: SSOSession,
  receiverEmail: string,
  receiverUserId: string,
  opts: { explicitInternal?: boolean },
): string {
  if (opts.explicitInternal || isSameAccountHandshakeEmails(session.email, receiverEmail)) {
    return session.sub
  }
  return receiverUserId
}

/**
 * Orchestrator instance id for relay registration — optional; omit when unavailable
 * (cross-party unchanged).
 *
 * Uses a static import (see top of file). The previous dynamic `require()` worked
 * under CommonJS but throws `ReferenceError: require is not defined` once the
 * Electron main bundle is emitted as ESM (vite-plugin-electron + `"type": "module"`).
 * The silently-caught throw was the root cause of `INTERNAL_ENDPOINT_INCOMPLETE`
 * for every internal initiate, even when the renderer had a valid `instanceId`.
 */
function getLocalDeviceIdForRelay(): string | undefined {
  try {
    const id = getOrchestratorInstanceId()
    return typeof id === 'string' && id.trim().length > 0 ? id.trim() : undefined
  } catch (err) {
    console.warn('[handshake.ipc] getLocalDeviceIdForRelay: orchestrator store unavailable:', err)
    return undefined
  }
}

/**
 * Local 6-digit pairing code from the orchestrator config. Used for the self-pair
 * check at initiate time and to render the "this device's code" diagnostic in the
 * acceptance mismatch message.
 *
 * Same ESM-safe static import pattern as `getLocalDeviceIdForRelay`.
 */
function getLocalPairingCode(): string | undefined {
  try {
    const code = getOrchestratorPairingCode()
    return typeof code === 'string' && /^\d{6}$/.test(code.trim()) ? code.trim() : undefined
  } catch (err) {
    console.warn('[handshake.ipc] getLocalPairingCode: orchestrator store unavailable:', err)
    return undefined
  }
}

/**
 * Format a `validateInternalEndpointFields` failure into the wire-level error
 * string returned by the IPC ("CODE: message"). For counterparty failures of
 * fields the renderer / resolve step is supposed to populate (`device_role`,
 * `computer_name`), the validator's own message already says "Internal error,
 * please report" — we additionally log at ERROR so the bug is captured even if
 * the user never reports it.
 *
 * For local failures (`device_id` / `device_role` / `computer_name`) we also log
 * at WARN level — these are user-actionable Settings issues, not bugs, but the
 * log helps when triaging "user said it didn't work" tickets.
 */
function formatInternalEndpointValidationFailure(
  v: import('../../../../../packages/shared/src/handshake/internalEndpointValidation').InternalEndpointPairValidationResult,
  context: { call: 'initiate' | 'buildForDownload' | 'accept'; handshake_id?: string },
): string {
  const tag = `[handshake.${context.call}]`
  const ctx = context.handshake_id ? ` handshake_id=${context.handshake_id}` : ''
  if (v.side === 'counterparty' && (v.missing_field === 'device_role' || v.missing_field === 'computer_name')) {
    console.error(
      `${tag} INTERNAL_ENDPOINT_INCOMPLETE programmer-bug: counterparty.${v.missing_field} not populated by renderer/resolve${ctx}`,
    )
  } else if (v.side === 'local' && v.missing_field) {
    console.warn(
      `${tag} INTERNAL_ENDPOINT_INCOMPLETE local Settings gap: ${v.missing_field}${ctx}`,
    )
  }
  return `${v.code}: ${v.message}`
}
import { vaultService } from '../vault/rpc'
import { USER_PACKAGE_BUILDER_SEND_SOURCE } from '../email/mergeExtensionDepackaged'
import {
  getDeviceX25519PublicKey,
  getDeviceX25519KeyPair,
  DeviceKeyNotFoundError,
} from '../device-keys/deviceKeyStore'

// ── Key Agreement: always generate paired keys in main process (qBEAP decrypt requires local secrets) ──

/** Thrown when device-bound key agreement cannot proceed (internal strict path or normal-accept guard). */
class BoundKeyAgreementError extends Error {
  readonly code: 'ERR_HANDSHAKE_BOUND_KEY_MISSING' | 'ERR_HANDSHAKE_ACCEPT_X25519_GUARD'

  constructor(
    message: string,
    code: 'ERR_HANDSHAKE_BOUND_KEY_MISSING' | 'ERR_HANDSHAKE_ACCEPT_X25519_GUARD' = 'ERR_HANDSHAKE_BOUND_KEY_MISSING',
  ) {
    super(message)
    this.name = 'BoundKeyAgreementError'
    this.code = code
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

type EnsureKeyAgreementKeysOptions = {
  /**
   * Internal handshakes: never mint a random X25519 keypair here — use caller-provided pubkey
   * (extension) or the orchestrator `device_keys` row. Otherwise fail fast (capsule vs encrypt drift).
   * Normal `handshake.accept` rejects a missing caller X25519 before this runs (see preflight below).
   * Other call sites (e.g. initiate) may still use ephemeral fallback when the caller omits the key.
   */
  strictDeviceBoundX25519?: boolean
  /**
   * Normal cross-principal `handshake.accept` only (`record.handshake_type !== 'internal'`).
   * When true, the ephemeral X25519 mint branch is unreachable: missing key throws
   * `ERR_HANDSHAKE_ACCEPT_X25519_GUARD` after a loud log (regression / preflight bypass).
   */
  forbidEphemeralX25519ForNormalAccept?: boolean
  /** Present with `forbidEphemeralX25519ForNormalAccept` so guard failures emit structured `[HANDSHAKE][ACCEPT_X25519]` diagnostics. */
  normalAcceptX25519BindingDiag?: {
    handshake_id: string
    local_role: string | null | undefined
    handshake_type: string | null | undefined
    rawParams: unknown
    ingress: string
  }
}

/**
 * Single extraction for `handshake.accept` X25519 — preflight and `ensureKeyAgreementKeys` MUST use this
 * so wire shapes cannot pass the guard yet reach ephemeral fallback (e.g. snake_case only).
 *
 * Acceptors pass X25519 via `senderX25519PublicKeyB64`, wire alias `sender_x25519_public_key_b64`, or nested
 * `key_agreement.x25519_public_key_b64`.
 */
function acceptorX25519FromHandshakeAcceptParams(params: unknown): string {
  const p = params as {
    senderX25519PublicKeyB64?: string | null
    sender_x25519_public_key_b64?: string | null
    key_agreement?: { x25519_public_key_b64?: string | null }
  }
  const camel = p?.senderX25519PublicKeyB64?.trim() ?? ''
  if (camel.length > 0) return camel
  const snake = typeof p?.sender_x25519_public_key_b64 === 'string' ? p.sender_x25519_public_key_b64.trim() : ''
  if (snake.length > 0) return snake
  return p?.key_agreement?.x25519_public_key_b64?.trim() ?? ''
}

/** Low-noise structured diagnostic for normal accept X25519 binding failures (no secrets / key material). */
export function logNormalAcceptX25519BindingFailure(diag: {
  handshake_id: string
  local_role?: string | null
  handshake_type?: string | null
  params: unknown
  ingress: string
}): void {
  const p = diag.params as {
    senderX25519PublicKeyB64?: string | null
    key_agreement?: { x25519_public_key_b64?: string | null } | null
  } | null
  const has_senderX25519PublicKeyB64 =
    typeof p?.senderX25519PublicKeyB64 === 'string' && p.senderX25519PublicKeyB64.trim().length > 0
  const nested = p?.key_agreement?.x25519_public_key_b64
  const has_nested_key_agreement_x25519 = typeof nested === 'string' && nested.trim().length > 0
  console.warn(
    '[HANDSHAKE][ACCEPT_X25519]',
    JSON.stringify({
      handshake_id: diag.handshake_id,
      local_role: diag.local_role ?? null,
      handshake_type: diag.handshake_type ?? null,
      has_senderX25519PublicKeyB64,
      has_nested_key_agreement_x25519,
      ingress: diag.ingress,
    }),
  )
}

function handshakeAcceptMissingX25519Result(handshake_id: string) {
  const msg =
    'ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED: Normal handshake accept requires the acceptor device X25519 public key ' +
    '(`senderX25519PublicKeyB64`, `sender_x25519_public_key_b64`, or `key_agreement.x25519_public_key_b64`). ' +
    'If it is omitted, Electron would generate an ephemeral X25519 key here, which breaks key continuity with the acceptor device and qBEAP decryption.'
  return {
    type: 'handshake-accept-result' as const,
    success: false as const,
    error: msg,
    code: 'ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED' as const,
    handshake_id,
    email_sent: false,
    email_error: undefined,
    local_result: { success: false as const, error: msg },
    context_sync_status: 'skipped' as const,
    electronGeneratedMlkemSecret: null,
    message: undefined,
  }
}

async function ensureKeyAgreementKeys(
  params: {
    sender_x25519_public_key_b64?: string | null
    sender_mlkem768_public_key_b64?: string | null
  },
  options?: EnsureKeyAgreementKeysOptions,
): Promise<BeapKeyAgreementMaterial> {
  const strictDeviceX25519 = options?.strictDeviceBoundX25519 === true
  // X25519: use the key provided by the caller (extension device key) when valid.
  // The extension sends its persistent chrome.storage device key so that the key
  // exchanged in the handshake capsule matches the key used at encrypt time.
  // Generating a fresh random key here (as the old code did) caused a split-brain:
  // the acceptor stored key A, but the sender encrypted with key B → AES-GCM auth failure.
  const providedX25519 = params.sender_x25519_public_key_b64?.trim()
  let x25519Pub: string
  let x25519Priv: string | null

  if (providedX25519 && providedX25519.length > 0) {
    // Caller supplied the extension's device public key. No private key is available here —
    // ECDH at send time is performed by the extension using its own chrome.storage private key.
    x25519Pub = providedX25519
    x25519Priv = null
    console.log('[KEY-AGREEMENT] Using caller-provided X25519 public key (extension device key)')
  } else if (strictDeviceX25519) {
    try {
      const devPub = await getDeviceX25519PublicKey()
      x25519Pub = devPub.trim()
      x25519Priv = null
      console.log('[KEY-AGREEMENT] Using orchestrator device X25519 public key (strict internal continuity)')
    } catch (e) {
      if (e instanceof DeviceKeyNotFoundError) {
        throw new BoundKeyAgreementError(
          'ERR_HANDSHAKE_BOUND_KEY_MISSING: Internal handshake requires a stable X25519 identity. ' +
            'Pass senderX25519PublicKeyB64 (or key_agreement.x25519_public_key_b64), or provision the orchestrator device key.',
        )
      }
      throw e
    }
  } else if (options?.forbidEphemeralX25519ForNormalAccept === true) {
    // Condition: non-internal handshake.accept passed forbidEphemeralX25519ForNormalAccept but landed in
    // the would-be ephemeral branch (no caller X25519 after trim, strictDeviceBoundX25519 false).
    // Preflight in handshake.accept should have returned ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED first.
    const d = options.normalAcceptX25519BindingDiag
    logNormalAcceptX25519BindingFailure({
      handshake_id: d?.handshake_id ?? '(unknown)',
      local_role: d?.local_role,
      handshake_type: d?.handshake_type,
      params: d?.rawParams ?? {},
      ingress: d?.ingress ?? 'ensureKeyAgreementKeys.forbid_ephemeral_x25519',
    })
    throw new BoundKeyAgreementError(
      'ERR_HANDSHAKE_ACCEPT_X25519_GUARD: Normal cross-principal handshake.accept must not mint an ephemeral X25519 keypair. ' +
        'A device public key is required; this path means a guard was bypassed.',
      'ERR_HANDSHAKE_ACCEPT_X25519_GUARD',
    )
  } else {
    // ERR_HANDSHAKE_BOUND_KEY_MISSING: generating a fresh X25519 keypair in a bound flow means
    // the acceptor will store a key the sender never uses for encryption — AES-GCM auth WILL fail.
    // Callers that genuinely need ephemeral keys (non-bound test flows) must pass the key explicitly.
    const x25519PrivKey = x25519.utils.randomPrivateKey()
    const x25519PubKey = x25519.getPublicKey(x25519PrivKey)
    x25519Pub = Buffer.from(x25519PubKey).toString('base64')
    x25519Priv = Buffer.from(x25519PrivKey).toString('base64')
    console.error(
      '[KEY-AGREEMENT] ERR_HANDSHAKE_BOUND_KEY_MISSING: No X25519 key provided — generating fresh keypair.',
      'This is a fatal drift risk in bound handshake flows.',
      'Ensure the extension sends senderX25519PublicKeyB64 before calling initiate/accept/buildForDownload.',
    )
  }

  // ML-KEM: same logic. Use the caller-provided public key when valid.
  // The ML-KEM secret key is NOT sent over IPC (it stays in chrome.storage on the extension).
  // Electron stores the Electron-generated ML-KEM secret for the initiator's own receive path.
  // When the extension sends its ML-KEM public key, that becomes the key the acceptor uses
  // for encapsulation when sending back — and the extension holds the matching secret.
  const providedMlkem = params.sender_mlkem768_public_key_b64?.trim()
  let mlkemPub: string
  let mlkemSecret: string | null

  if (providedMlkem && providedMlkem.length > 0) {
    mlkemPub = providedMlkem
    mlkemSecret = null
    console.log('[KEY-AGREEMENT] Using caller-provided ML-KEM-768 public key (extension session key)')
  } else {
    const pq = await import('@noble/post-quantum/ml-kem')
    const mlkemKeypair = pq.ml_kem768.keygen()
    mlkemPub = Buffer.from(mlkemKeypair.publicKey).toString('base64')
    mlkemSecret = Buffer.from(mlkemKeypair.secretKey).toString('base64')
    console.error(
      '[KEY-AGREEMENT] ERR_HANDSHAKE_BOUND_KEY_MISSING: No ML-KEM key provided — generating fresh keypair.',
      'Electron-generated secret MUST be returned to the extension via electronGeneratedMlkemSecret.',
      'If caller discards that field, inbound hybrid qBEAP WILL fail AES-GCM decryption.',
    )
  }

  return {
    sender_x25519_public_key_b64: x25519Pub,
    sender_mlkem768_public_key_b64: mlkemPub,
    sender_x25519_private_key_b64: x25519Priv,
    sender_mlkem768_secret_key_b64: mlkemSecret,
  }
}

// ── Context Block Helpers ──

const MAX_MESSAGE_BYTES = 32 * 1024

/** Map structured field path to human-readable label for Search result titles. */
const PATH_TO_LABEL: Record<string, string> = {
  'billing.payment_methods': 'Payment details',
  'tax.vat_number': 'VAT number',
  'tax.registration_number': 'Registration details',
  'company.legal_name': 'Legal company',
  'company.name': 'Company name',
  'company.address': 'Address',
  'company.headquarters': 'Headquarters',
  'company.country': 'Country',
  'company.links': 'Links',
  'contact.general.email': 'Contact email',
  'contact.general.phone': 'Contact phone',
  'contact.support.email': 'Support email',
  'contact.support.phone': 'Support phone',
  'contact.persons': 'Contact details',
  'opening_hours.schedule': 'Opening hours',
}
function pathToHumanLabel(path: string): string {
  return PATH_TO_LABEL[path] ?? (path.split('.').pop() ?? path).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Recursively collect string values from JSON for snippet display (avoids raw JSON in UI). */
function collectStringsFromJson(val: unknown): string[] {
  if (val == null) return []
  if (typeof val === 'string') return [val]
  if (typeof val === 'number' || typeof val === 'boolean') return [String(val)]
  if (Array.isArray(val)) return val.flatMap((v) => collectStringsFromJson(v))
  if (typeof val === 'object') return Object.values(val).flatMap((v) => collectStringsFromJson(v))
  return []
}

/** Extract readable snippet from payload (JSON or plain text) for search result display. */
function extractSnippetFromPayload(payload: string, maxLen = 200): string {
  if (!payload || typeof payload !== 'string') return ''
  const trimmed = payload.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'string') return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + '…' : trimmed
    if (parsed && typeof parsed === 'object') {
      const parts = collectStringsFromJson(parsed).filter(Boolean)
      const text = parts.join(' ').replace(/\s+/g, ' ').trim()
      return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
    }
  } catch { /* not JSON */ }
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + '…' : trimmed
}
const MAX_BLOCKS_PER_CAPSULE = 64

/** Raw block from client; may include per-item policy (Phase 2) */
interface RawBlockWithPolicy extends ContextBlockForCommitment {
  policy_mode?: 'inherit' | 'override'
  policy?: { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }
}

/** Result of building blocks with per-item policy map (block_id -> effective policy) */
interface BuildBlocksResult {
  blocks: ContextBlockForCommitment[]
  blockPolicyMap: Map<string, { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }>
}

/**
 * Convert raw RPC params (pre-built context_blocks and/or a plain message string)
 * into a fully formed ContextBlockForCommitment array ready for the capsule builder.
 *
 * block_ids assigned here are provisional — the capsule builder will
 * reassign canonical IDs scoped to the handshake_id.
 *
 * Phase 2: When raw blocks have policy_mode=override and policy, those are collected
 * in blockPolicyMap for per-item governance resolution.
 */
function buildContextBlocksFromParams(
  rawBlocks: RawBlockWithPolicy[] | ContextBlockForCommitment[] | undefined,
  rawMessage: string | undefined,
): ContextBlockForCommitment[] {
  const result = buildContextBlocksFromParamsWithPolicy(rawBlocks, rawMessage)
  return result.blocks
}

function buildContextBlocksFromParamsWithPolicy(
  rawBlocks: RawBlockWithPolicy[] | ContextBlockForCommitment[] | undefined,
  rawMessage: string | undefined,
): BuildBlocksResult {
  const blocks: ContextBlockForCommitment[] = []
  const blockPolicyMap = new Map<string, { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }>()

  if (Array.isArray(rawBlocks)) {
    for (const b of rawBlocks) {
      if (blocks.length >= MAX_BLOCKS_PER_CAPSULE) break
      if (
        typeof b.block_id === 'string' && b.block_id.length > 0 && b.block_id.length <= 256 &&
        typeof b.block_hash === 'string' && /^[a-f0-9]{64}$/.test(b.block_hash) &&
        typeof b.type === 'string' && b.type.length > 0 &&
        b.content !== undefined && b.content !== null
      ) {
        const recomputed = computeBlockHash(b.content)
        if (recomputed !== b.block_hash) continue
        blocks.push(b)
        const withPolicy = b as RawBlockWithPolicy
        if (withPolicy.policy_mode === 'override' && withPolicy.policy) {
          blockPolicyMap.set(b.block_id, withPolicy.policy)
        }
      }
    }
  }

  if (typeof rawMessage === 'string' && rawMessage.trim().length > 0) {
    const content = rawMessage.trim()
    if (Buffer.byteLength(content, 'utf-8') <= MAX_MESSAGE_BYTES && blocks.length < MAX_BLOCKS_PER_CAPSULE) {
      const blockHash = computeBlockHash(content)
      blocks.push({
        block_id: `ctx-msg-pending`,
        block_hash: blockHash,
        type: 'plaintext',
        content,
      })
    }
  }

  return { blocks, blockPolicyMap }
}

/**
 * Resolve HS Context Profile IDs to ContextBlockForCommitment[].
 * Requires vault service and Publisher+ tier. Used when acceptor attaches
 * Vault Profiles during handshake accept.
 *
 * Uses __og_vault_service_ref when available; falls back to vaultService
 * direct import when ref is undefined (avoids ref lifecycle issues).
 */
function resolveProfileIdsToContextBlocks(
  profileIds: string[],
  session: SSOSession,
  handshakeId: string,
  scope: 'acceptor' | 'initiator' = 'acceptor',
): ContextBlockForCommitment[] {
  const ref = (globalThis as any).__og_vault_service_ref as { resolveHsProfilesForHandshake?: (tier: string, ids: string[]) => any[] } | undefined

  // ── Diagnostic logging ──
  console.log('[HS Profile Resolution] resolveProfileIdsToContextBlocks:', {
    profileIds,
    profileCount: profileIds?.length ?? 0,
    refDefined: !!ref,
    resolveFnDefined: !!ref?.resolveHsProfilesForHandshake,
  })
  if (!ref?.resolveHsProfilesForHandshake) {
    console.warn('[HS Profile Resolution] [CRITICAL] resolveHsProfilesForHandshake not available on vault service ref — attempting fallback to vaultService direct')
  }

  if (!profileIds?.length) return []

  let resolveFn = ref?.resolveHsProfilesForHandshake
  if (!resolveFn) {
    try {
      resolveFn = vaultService?.resolveHsProfilesForHandshake?.bind(vaultService)
      if (resolveFn) {
        console.log('[HS Profile Resolution] Using vaultService direct fallback (ref was undefined)')
      }
    } catch (e: any) {
      console.warn('[HS Profile Resolution] Fallback failed:', e?.message ?? e)
    }
  }

  if (!resolveFn) {
    console.warn('[HS Profile Resolution] [CRITICAL] resolveHsProfilesForHandshake not available — profile blocks will be empty')
    return []
  }

  const effectiveTier = session.canonical_tier ?? session.plan
  const tier = (effectiveTier === 'enterprise' || effectiveTier === 'publisher' || effectiveTier === 'publisher_lifetime')
    ? (effectiveTier as 'enterprise' | 'publisher' | 'publisher_lifetime')
    : 'free'
  if (tier === 'free') {
    console.log('[HS Profile Resolution] Tier is free — skipping profile resolution')
    return []
  }

  try {
    const resolved = resolveFn(tier, profileIds)

    // ── Post-resolution diagnostic ──
    console.log('[HS Profile Resolution] Resolved:', {
      profileCount: resolved?.length ?? 0,
      profiles: (resolved ?? []).map((r: any) => ({
        name: r?.profile?.name,
        docCount: r?.documents?.length ?? 0,
        docs: (r?.documents ?? []).map((d: any) => ({
          filename: d?.filename,
          hasExtractedText: !!(d?.extracted_text),
          extractionStatus: d?.extraction_status,
        })),
      })),
    })

    const blocks: ContextBlockForCommitment[] = []
    const shortId = handshakeId.replace(/^hs-/, '').slice(0, 8)
    const scopeLabel = scope === 'acceptor' ? 'acceptor' : 'initiator'
    for (let i = 0; i < resolved.length && blocks.length < MAX_BLOCKS_PER_CAPSULE; i++) {
      const { profile, documents } = resolved[i]
      const profileSensitive = documents.some((d: any) => d.sensitive === true)
      const content = JSON.stringify({
        profile: { id: profile.id, name: profile.name, description: profile.description, fields: profile.fields, custom_fields: profile.custom_fields },
        documents: documents.map((d: any) => ({
          id: d.id,
          filename: d.filename,
          label: d.label ?? null,
          document_type: d.document_type ?? null,
          extracted_text: d.extracted_text,
          sensitive: !!d.sensitive,
        })),
      })
      const blockHash = computeBlockHash(content)
      blocks.push({
        block_id: `ctx-${shortId}-${scopeLabel}-${String(i + 1).padStart(3, '0')}`,
        block_hash: blockHash,
        type: 'vault_profile',
        content,
        scope_id: scope,
        profileSensitive,
      } as any)
    }
    console.log('[HS Profile Resolution] Built', blocks.length, 'blocks')
    return blocks
  } catch (err: any) {
    console.error('[HS Profile Resolution] Resolution threw:', err?.message ?? err)
    return []
  }
}

// ── SSO Session Provider ──

export type SSOSessionProvider = () => SSOSession | undefined
export type OidcTokenProvider = () => Promise<string | null>

let _getSession: SSOSessionProvider = () => undefined
let _getOidcToken: OidcTokenProvider = async () => null

/**
 * Inject the SSO session provider. Called once at app startup.
 * The provider returns the currently authenticated SSOSession,
 * or undefined if no session is active.
 */
export function setSSOSessionProvider(provider: SSOSessionProvider): void {
  _getSession = provider
}

/**
 * Inject the OIDC token provider for coordination service auth.
 */
export function setOidcTokenProvider(provider: OidcTokenProvider): void {
  _getOidcToken = provider
}

/** @internal */
export function _resetSSOSessionProvider(): void {
  _getSession = () => undefined
  _getOidcToken = async () => null
}

/**
 * Return the current SSO session, or undefined if none is active.
 * Exported so main.ts can use it without going through the vault service.
 */
export function getCurrentSession() {
  return _getSession()
}

/** OIDC bearer for coordination `register-handshake` and deferred context_sync drain (mirrors setOidcTokenProvider). */
export function getCoordinationOidcToken(): Promise<string | null> {
  return _getOidcToken()
}

function requireSession(): SSOSession {
  const session = _getSession()
  if (!session) {
    throw new Error('No active SSO session. Authentication required for handshake operations.')
  }
  return session
}

function getCounterpartyEmail(record: HandshakeRecord, session: SSOSession): string {
  if (record.initiator.wrdesk_user_id === session.wrdesk_user_id) {
    return record.acceptor?.email ?? ''
  }
  return record.initiator.email
}

export async function handleHandshakeRPC(
  method: string,
  params: any,
  db: any,
): Promise<any> {
  switch (method) {
    case 'handshake.queryStatus': {
      const record = getHandshakeRecord(db, params.handshakeId)
      return {
        type: 'handshake-status',
        record: record ?? null,
        reason: record ? ReasonCode.OK : ReasonCode.HANDSHAKE_NOT_FOUND,
      }
    }

    case 'handshake.get': {
      const { handshake_id } = params as { handshake_id: string }
      if (!handshake_id) return { error: 'handshake_id is required' }
      const record = getHandshakeRecord(db, handshake_id)
      if (!record) return { error: 'Handshake not found', reason: ReasonCode.HANDSHAKE_NOT_FOUND }
      return { record }
    }

    case 'handshake.getPendingP2PBeapMessages': {
      const items = getPendingP2PBeapMessages(db)
      return { type: 'p2p-pending-beap-list', items }
    }

    case 'handshake.ackPendingP2PBeap': {
      const { id } = params as { id: number }
      if (typeof id !== 'number') return { success: false, error: 'id is required' }
      if (!db) return { success: false, error: 'Database unavailable' }
      markP2PPendingBeapProcessed(db, id)
      return { success: true }
    }

    case 'handshake.getPendingPlainEmails': {
      const items = getPendingPlainEmails(db)
      return { type: 'plain-email-list', items }
    }

    case 'handshake.ackPendingPlainEmail': {
      const { id } = params as { id: number }
      if (typeof id !== 'number') return { success: false, error: 'id is required' }
      if (!db) return { success: false, error: 'Database unavailable' }
      markPlainEmailProcessed(db, id)
      return { success: true }
    }

    case 'handshake.requestContextBlocks': {
      const { handshakeId, scopes, purpose } = params
      const auth = authorizeAction(db, handshakeId, 'read-context', scopes ?? [], new Date())
      if (!auth.allowed) {
        return { type: 'context-blocks', blocks: [], reason: auth.reason }
      }
      let blocks = queryContextBlocksWithGovernance(db, handshakeId)
      const record = getHandshakeRecord(db, handshakeId)
      const baseline = record ? baselineFromHandshake(record) : null
      if (purpose === 'local_ai') {
        blocks = filterBlocksForLocalAI(blocks, baseline)
      } else if (purpose === 'cloud_ai') {
        blocks = filterBlocksForCloudAI(blocks, baseline)
      } else if (purpose === 'export') {
        blocks = filterBlocksForExport(blocks, baseline)
      } else if (purpose === 'search') {
        blocks = filterBlocksForSearch(blocks, baseline)
      } else if (purpose === 'peer_transmission') {
        blocks = filterBlocksForPeerTransmission(blocks, baseline)
      } else if (purpose === 'auto_reply') {
        blocks = filterBlocksForAutoReply(blocks, baseline)
      }
      return { type: 'context-blocks', blocks, reason: ReasonCode.OK }
    }

    case 'handshake.authorizeAction': {
      const { handshakeId, action, scopes } = params
      const result = authorizeAction(db, handshakeId, action, scopes ?? [], new Date())
      return { type: 'authorization-result', allowed: result.allowed, reason: result.reason }
    }

    case 'handshake.initiateRevocation': {
      const { handshakeId } = params
      try {
        let session: SSOSession
        try { session = requireSession() } catch (err: any) {
          return { type: 'revocation-result', success: false, reason: ReasonCode.UNAUTHENTICATED }
        }
        await revokeHandshake(db, handshakeId, 'local-user', session.wrdesk_user_id, session, _getOidcToken)
        return { type: 'revocation-result', success: true, reason: ReasonCode.OK }
      } catch {
        return { type: 'revocation-result', success: false, reason: ReasonCode.INTERNAL_ERROR }
      }
    }

    case 'handshake.importCapsule': {
      const { capsuleJson } = params as { capsuleJson: string }
      if (!capsuleJson || typeof capsuleJson !== 'string') {
        return { success: false, error: 'capsuleJson is required', reason: 'INVALID_INPUT' }
      }
      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message, reason: 'NO_SESSION' }
      }
      if (!db) {
        return { success: false, error: 'Database unavailable. Please unlock vault or ensure you are logged in.', reason: 'DB_UNAVAILABLE' }
      }
      const rawInput = {
        body: capsuleJson,
        mime_type: 'application/vnd.beap+json' as const,
        headers: { 'content-type': 'application/vnd.beap+json' },
      }
      const result = await processIncomingInput(rawInput, 'file_upload', { mime_type: 'application/vnd.beap+json' })
      if (!result.success) {
        return { success: false, error: result.reason ?? 'Capsule validation failed', reason: result.validation_reason_code ?? 'VALIDATION_FAILED' }
      }
      const { distribution } = result
      if (distribution.target !== 'handshake_pipeline') {
        return { success: false, error: 'Capsule is not a handshake capsule', reason: 'NOT_HANDSHAKE_PIPELINE' }
      }
      const cap = distribution.validated_capsule?.capsule as Record<string, unknown> | undefined
      const capsuleType = (cap?.capsule_type as string) ?? ''
      const handshakeId = (cap?.handshake_id as string) ?? ''
      console.log('[IMPORT] Parsed OK, type:', capsuleType, 'id:', handshakeId)
      if (capsuleType !== 'initiate') {
        return { success: false, error: `Only initiate capsules can be imported. Got: ${capsuleType}`, reason: 'NOT_INITIATE_CAPSULE' }
      }

      // LAYER 3 — Import validation: reject if receiver_email does not match current user
      const capsuleReceiverEmail = cap?.receiver_email as string | undefined
      const importCheck = validateReceiverEmail(capsuleReceiverEmail, session.email)
      if (!importCheck.valid) {
        const receiverDisplay = (capsuleReceiverEmail && String(capsuleReceiverEmail).trim()) || '(unknown)'
        return {
          success: false,
          error: `Cannot import: This handshake is addressed to ${receiverDisplay}. Your account (${session.email}) is not the intended recipient. Ask the sender to create a new handshake for your email address.`,
          reason: 'RECEIVER_EMAIL_MISMATCH',
        }
      }

      const existing = getHandshakeRecord(db, handshakeId)
      if (existing) {
        return { success: false, error: 'Handshake already exists', reason: 'HANDSHAKE_ALREADY_EXISTS' }
      }
      const rebuildResult = canonicalRebuild(distribution.validated_capsule.capsule)
      if (!rebuildResult.ok) {
        return { success: false, error: rebuildResult.reason ?? 'Canonical rebuild failed', reason: 'CANONICAL_REBUILD_FAILED' }
      }
      const canonicalValidated = { ...distribution.validated_capsule, capsule: rebuildResult.capsule }
      const persistResult = persistRecipientHandshakeRecord(db, canonicalValidated, session)
      if (!persistResult.success) {
        return { success: false, error: persistResult.error, reason: persistResult.reason ?? 'PERSIST_FAILED' }
      }

      const senderIdentity = cap?.senderIdentity as { email?: string } | undefined
      const capsuleSenderEmail = (senderIdentity?.email ?? cap?.sender_email) as string | undefined
      if (
        persistResult.handshake_id &&
        capsuleSenderEmail &&
        isSameAccountHandshakeEmails(capsuleSenderEmail, capsuleReceiverEmail)
      ) {
        try {
          db.prepare(`UPDATE handshakes SET handshake_type = ? WHERE handshake_id = ?`).run('internal', persistResult.handshake_id)
          refreshInternalHandshakePersistenceFlags(db, persistResult.handshake_id)
        } catch (e) {
          console.warn('[IMPORT] Could not mark handshake as internal:', e)
        }
      }

      return {
        success: true,
        handshake_id: persistResult.handshake_id,
        state: HS.PENDING_REVIEW,
        sender: (cap?.senderIdentity ?? cap?.sender_email) as { email?: string } | string,
      }
    }

    case 'handshake.list': {
      const filter = params?.filter as { state?: HandshakeState; relationship_id?: string; handshake_type?: string } | undefined
      let records = listHandshakeRecords(db, filter)

      // LAYER 2 — Visibility filtering: receiver-only handshakes must match current user's email
      let session: SSOSession | undefined
      try {
        session = requireSession()
      } catch {
        session = undefined
      }
      if (session?.email) {
        const userEmails = session.email
        records = records.filter((r) => {
          // Initiator: always show (they created it)
          if (r.local_role === 'initiator') return true
          // Active/completed: always show (don't hide history)
          if (r.state === HS.ACCEPTED || r.state === HS.ACTIVE || r.state === HS.EXPIRED || r.state === HS.REVOKED) {
            return true
          }
          // Acceptor, pending: only show if receiver_email matches
          if (r.local_role === 'acceptor' && (r.state === HS.PENDING_ACCEPT || r.state === HS.PENDING_REVIEW)) {
            const check = validateReceiverEmail(r.receiver_email, userEmails)
            return check.valid
          }
          return true
        })
      }

      return { type: 'handshake-list', records }
    }

    case 'handshake.delete': {
      const { handshakeId } = params as { handshakeId: string }
      if (!handshakeId) return { success: false, error: 'handshakeId is required' }
      const result = deleteHandshakeRecord(db, handshakeId)
      return result.success ? { success: true } : { success: false, error: result.error }
    }

    case 'handshake.sendBeapViaP2P': {
      const { handshakeId, packageJson, sendSource } = params as {
        handshakeId: string
        packageJson: string
        sendSource?: string
      }
      if (!handshakeId || !packageJson) {
        return { success: false, error: 'handshakeId and packageJson are required' }
      }
      if (sendSource !== USER_PACKAGE_BUILDER_SEND_SOURCE) {
        console.warn('[P2P-SEND] Blocked — sendSource must be user_package_builder, got:', sendSource)
        return {
          success: false,
          error:
            'BEAP P2P send requires explicit user action (Send). Automatic or background sends are disabled.',
        }
      }
      if (!db) return { success: false, error: 'Database unavailable' }
      const activeCheck = diagnoseHandshakeInactive(db, handshakeId, new Date())
      if (!activeCheck.active) {
        return { success: false, error: activeCheck.reason }
      }
      const record = getHandshakeRecord(db, handshakeId)
      if (!record) return { success: false, error: 'Handshake not found' }
      const targetEndpoint = record.p2p_endpoint?.trim()
      if (!targetEndpoint) {
        return { success: false, error: 'Recipient has no P2P endpoint' }
      }

      // ── Hard guard: handshake MUST have a bound local X25519 key for P2P send ──
      // Handshakes created before schema v50 have NULL local_x25519_public_key_b64.
      // Without this key we cannot validate the three-way invariant and the package
      // will be built with an unverified device key that the receiver cannot trust.
      // This is ERR_HANDSHAKE_LOCAL_KEY_MISSING — distinct from MISMATCH (key present
      // but differs). Re-establishment is the only safe path.
      if (!record.local_x25519_public_key_b64?.trim()) {
        console.error(
          '[P2P-SEND] ERR_HANDSHAKE_LOCAL_KEY_MISSING: handshake has no bound local X25519 key stored.',
          'Handshake was created before schema v50 (key-binding persistence).',
          'Delete and re-establish the handshake.',
          { handshakeId, state: record.state },
        )
        return {
          success: false,
          queued: false,
          error: [
            'ERR_HANDSHAKE_LOCAL_KEY_MISSING: This handshake has no bound local X25519 public key stored.',
            'It was created before key-binding persistence was added.',
            'Delete and re-establish the handshake — the receiver cannot validate sender identity without it.',
          ].join(' '),
          code: 'ERR_HANDSHAKE_LOCAL_KEY_MISSING',
        }
      }
      let pkg: object
      try {
        pkg = JSON.parse(packageJson) as object
      } catch (err: any) {
        return { success: false, error: `Invalid package: ${err?.message ?? 'decode failed'}` }
      }
      // Main-process diagnostic: compare DB peer_* / local_* to wire header (sender keys in package).
      try {
        const pkgAny = pkg as Record<string, unknown>
        const header = pkgAny?.header as Record<string, unknown> | undefined
        const hdr =
          header?.crypto && typeof header.crypto === 'object' && header.crypto !== null
            ? (header.crypto as Record<string, unknown>)
            : pkgAny?.crypto && typeof pkgAny.crypto === 'object' && pkgAny.crypto !== null
              ? (pkgAny.crypto as Record<string, unknown>)
              : {}
        const senderX25519B64 =
          typeof hdr.senderX25519PublicKeyB64 === 'string' ? hdr.senderX25519PublicKeyB64 : ''
        console.log(
          '[P2P-SEND] SENDER KEY CHECK:',
          JSON.stringify({
            ourPeerX25519ForRecipient: record.peer_x25519_public_key_b64?.substring(0, 24) || 'NULL',
            ourPeerMlkemForRecipient: record.peer_mlkem768_public_key_b64?.substring(0, 24) || 'NULL',
            ourLocalX25519Pub: record.local_x25519_public_key_b64?.substring(0, 24) || 'NULL',
            ourLocalMlkemPub: record.local_mlkem768_public_key_b64?.substring(0, 24) || 'NULL',
            headerSenderX25519: senderX25519B64 ? senderX25519B64.substring(0, 24) : 'N/A',
            handshakeId,
            ourRole: record.local_role || 'unknown',
          }),
        )
      } catch (e) {
        console.log('[P2P-SEND] Key check parse error:', e)
      }

      // ── Sender-side bound key check ──────────────────────────────────────────
      // The key placed in the header by BeapPackageBuilder (senderX25519PublicKeyB64)
      // MUST match the key stored for this handshake in our local DB
      // (local_x25519_public_key_b64). If they differ the receiver's ECDH will
      // produce a different shared secret and AES-GCM auth will fail on every message.
      try {
        const pkgAny2 = pkg as Record<string, unknown>
        const hdr2 =
          ((pkgAny2?.header as Record<string, unknown> | undefined)?.crypto ??
            pkgAny2?.crypto) as Record<string, unknown> | undefined
        const headerSenderKey =
          typeof hdr2?.senderX25519PublicKeyB64 === 'string'
            ? hdr2.senderX25519PublicKeyB64.trim()
            : ''
        const handshakeLocalKey = record.local_x25519_public_key_b64?.trim() ?? ''
        const keyMatch = headerSenderKey && handshakeLocalKey && headerSenderKey === handshakeLocalKey
        console.log('[P2P-SEND] BOUND KEY CHECK:', JSON.stringify({
          handshakeId,
          localX25519: handshakeLocalKey.substring(0, 24) || 'NULL',
          handshakeLocalX25519: handshakeLocalKey.substring(0, 24) || 'NULL',
          headerSenderX25519: headerSenderKey.substring(0, 24) || 'NULL',
          match: keyMatch,
        }))
        if (headerSenderKey && handshakeLocalKey && !keyMatch) {
          console.error(
            '[P2P-SEND] ERR_HANDSHAKE_LOCAL_KEY_MISMATCH: header senderX25519 ≠ handshake local_x25519.',
            'Receiver will derive a wrong ECDH secret. Blocking send.',
            { handshakeId, localKeyPrefix: handshakeLocalKey.substring(0, 24), headerKeyPrefix: headerSenderKey.substring(0, 24) },
          )
          return {
            success: false,
            // queued: false is required so callers do not append "— queued for retry".
            // This is a deterministic protocol mismatch that cannot self-heal — the
            // handshake must be re-established with matching keys.
            queued: false,
            error: 'ERR_HANDSHAKE_LOCAL_KEY_MISMATCH: The key in the package header does not match this handshake\'s bound local key. This indicates the sender built the package with a stale or incorrect device key. Delete and re-establish the handshake, or ensure the extension device key has not been regenerated since the handshake was created.',
            code: 'ERR_HANDSHAKE_LOCAL_KEY_MISMATCH',
          }
        }
      } catch (e) {
        console.warn('[P2P-SEND] Bound key check error (non-fatal):', e)
      }

      // `pkg` is parsed JSON: BEAP message package (header/metadata/envelope|payload) from the extension,
      // or a capsule envelope — coordination `/beap/capsule` accepts both (see coordination-service).
      console.log(`[P2P-SEND] Enqueuing capsule for handshake ${handshakeId} → ${targetEndpoint}`)
      const enqCap = enqueueOutboundCapsule(db, handshakeId, targetEndpoint, pkg)
      if (!enqCap.enqueued) {
        const errJson = formatLocalInternalRelayValidationJson({
          phase: 'enqueue_guard',
          invariant: enqCap.invariant,
          message: enqCap.message,
          missing_fields: enqCap.missing_fields,
        })
        return {
          success: false,
          delivered: false,
          queued: false,
          error: errJson,
          code: 'LOCAL_INTERNAL_RELAY_VALIDATION_FAILED',
        }
      }
      const deliveryResult = await processOutboundQueue(db, _getOidcToken)
      console.log('[P2P-SEND] Delivery result:', JSON.stringify({
        delivered: deliveryResult.delivered,
        code: deliveryResult.code,
        http_status: deliveryResult.http_status,
        error: deliveryResult.error,
      }))
      if (!deliveryResult.delivered) {
        const d = deliveryResult as ProcessOutboundQueueResult
        return {
          success: false,
          delivered: d.delivered,
          error: d.error ?? 'Delivery failed — capsule queued for retry',
          queued: d.queued !== false,
          ...(d.code && { code: d.code }),
          ...(d.last_queue_error !== undefined && { last_queue_error: d.last_queue_error }),
          ...(d.retry_count !== undefined && { retry_count: d.retry_count }),
          ...(d.max_retries !== undefined && { max_retries: d.max_retries }),
          ...(d.remaining_ms !== undefined && { remaining_ms: d.remaining_ms }),
          ...(d.next_retry_at !== undefined && { next_retry_at: d.next_retry_at }),
          ...(d.failure_class !== undefined && { failure_class: d.failure_class }),
          ...(d.healing_status !== undefined && { healing_status: d.healing_status }),
          ...(d.http_status !== undefined && { http_status: d.http_status }),
          ...(d.response_body_snippet !== undefined && { response_body_snippet: d.response_body_snippet }),
          ...(d.outbound_debug !== undefined && { outbound_debug: d.outbound_debug }),
          ...(d.derived_outgoing_relay_capsule_type !== undefined && {
            derived_outgoing_relay_capsule_type: d.derived_outgoing_relay_capsule_type,
          }),
        }
      }
      const ok = deliveryResult as ProcessOutboundQueueResult
      return {
        success: true,
        delivered: ok.delivered,
        recipient_ingest_confirmed: false,
        ...(ok.code && { code: ok.code }),
        ...(ok.healing_status !== undefined && { healing_status: ok.healing_status }),
        ...(ok.coordinationRelayDelivery && {
          coordinationRelayDelivery: ok.coordinationRelayDelivery,
        }),
      }
    }

    case 'handshake.checkSendReady': {
      const { handshakeId } = params as { handshakeId: string }
      if (!handshakeId) return { ready: false, error: 'handshakeId is required' }
      if (!db) return { ready: false, error: 'Database unavailable' }
      const record = getHandshakeRecord(db, handshakeId)
      if (!record) return { ready: false, error: 'Handshake not found' }
      const activeCheck = diagnoseHandshakeInactive(db, handshakeId, new Date())
      if (!activeCheck.active) return { ready: false, error: activeCheck.reason }
      if (!record.p2p_endpoint?.trim()) return { ready: false, error: 'Recipient has no P2P endpoint' }

      // Auto-repair: if the handshake's bound local X25519 public key doesn't match the current
      // device key BUT the private key is NOT stored in the handshake record (it lives in the
      // orchestrator device_keys table), the bound public key can safely be updated.
      //
      // Why: local_x25519_private_key_b64 = NULL means deriveSharedSecretX25519() always uses
      // the current orchestrator device private key regardless of what local_x25519_public_key_b64
      // says. The mismatch only occurred because the device key migration ran after accept and
      // generated a new key. Since the private key is canonical in the orchestrator DB, updating
      // the public key in the handshake record makes them consistent again.
      //
      // IMPORTANT: Do NOT auto-repair when local_x25519_private_key_b64 is non-null.
      // Old handshakes store an ephemeral private key that was used at accept time. That key is
      // still needed by decryptQBeapPackage.ts to decrypt any messages received BEFORE the
      // migration. Nulling it out or overwriting local_x25519_public_key_b64 would permanently
      // destroy the ability to decrypt those old messages. The send path (deriveSharedSecretX25519)
      // now routes through the orchestrator DB regardless — so old handshakes work fine for send.
      let localX25519PublicKey = record.local_x25519_public_key_b64 ?? undefined
      if (record.local_x25519_public_key_b64 && !record.local_x25519_private_key_b64) {
        try {
          const { getDeviceX25519PublicKey: getDevPub } = await import('../device-keys/deviceKeyStore')
          const currentDeviceKey = await getDevPub()
          if (currentDeviceKey && currentDeviceKey.trim() !== record.local_x25519_public_key_b64.trim()) {
            console.log(
              '[HANDSHAKE] checkSendReady: auto-repairing local_x25519_public_key_b64 — device key changed since accept.',
              { handshakeId, old: record.local_x25519_public_key_b64.substring(0, 24), new: currentDeviceKey.substring(0, 24) },
            )
            updateHandshakeRecord(db, { ...record, local_x25519_public_key_b64: currentDeviceKey })
            localX25519PublicKey = currentDeviceKey
          }
        } catch (e) {
          // Non-fatal — if device key read fails, return the stored value and let the builder handle it.
          console.warn('[HANDSHAKE] checkSendReady: device key read failed during auto-repair check:', e)
        }
      }

      // Return the live local_x25519_public_key_b64 so the builder can use the DB value
      // instead of the potentially stale value from the extension's cached handshake list.
      // Also return hasStoredPrivateKey so BeapPackageBuilder knows whether to enforce the
      // three-way invariant check (only required for new-flow handshakes where ECDH uses the
      // device key; old-flow handshakes use the stored ephemeral private key so a mismatch
      // against the current device key is expected and safe).
      return {
        ready: true,
        localX25519PublicKey,
        hasStoredPrivateKey: !!record.local_x25519_private_key_b64,
      }
    }

    case 'handshake.isActive': {
      const active = isHandshakeActive(db, params.handshakeId, new Date())
      return { type: 'handshake-status', active, reason: ReasonCode.OK }
    }

    // ── New methods: initiate / accept / refresh ──

    case 'handshake.initiate': {
      const {
        receiverUserId,
        receiverEmail,
        fromAccountId,
        skipVaultContext,
        context_blocks: rawBlocks,
        message: rawMessage,
        profile_ids: initProfileIds,
        profile_items: initProfileItems,
        p2p_endpoint: p2pEndpointParam,
        policy_selections: initPolicySelections,
        handshake_type: initHandshakeType,
        device_name: initDeviceName,
        device_role: initDeviceRole,
        counterparty_device_id: initCounterpartyDeviceIdRaw,
        counterparty_device_role: initCounterpartyDeviceRole,
        counterparty_computer_name: initCounterpartyComputerNameRaw,
        counterparty_pairing_code: initCounterpartyPairingCode,
      } = params as {
        receiverUserId: string
        receiverEmail: string
        fromAccountId: string
        skipVaultContext?: boolean
        context_blocks?: RawBlockWithPolicy[]
        message?: string
        profile_ids?: string[]
        profile_items?: Array<{ profile_id: string; policy_mode?: 'inherit' | 'override'; policy?: { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean } }>
        p2p_endpoint?: string | null
        policy_selections?: { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }
        handshake_type?: 'internal' | 'standard'
        device_name?: string
        device_role?: 'host' | 'sandbox'
        counterparty_device_id?: string
        counterparty_device_role?: 'host' | 'sandbox'
        counterparty_computer_name?: string
        /**
         * 6-digit internal pairing code for the target device. When provided (and
         * `handshake_type === 'internal'`), the IPC handler resolves it to
         * `counterparty_device_id` + `counterparty_computer_name` via the coordination
         * service so the renderer never needs to know the peer's full instance_id.
         * Ignored when `counterparty_device_id` is already provided (legacy callers).
         */
        counterparty_pairing_code?: string
      }

      // Pairing-code routing: receiver_pairing_code is the sole peer identifier for new
      // internal initiate capsules. counterparty_device_id / counterparty_computer_name are
      // accepted for backwards compatibility but no longer required and not used to route
      // — they survive only as descriptive metadata if a caller still passes them.
      const initCounterpartyDeviceId = initCounterpartyDeviceIdRaw
      const initCounterpartyComputerName = initCounterpartyComputerNameRaw
      const initReceiverPairingCode = normalizePairingCode(initCounterpartyPairingCode ?? null)

      if (!receiverUserId || !receiverEmail) {
        return { success: false, error: 'receiverUserId and receiverEmail are required' }
      }

      if (initHandshakeType === 'internal') {
        const localRelayId = getLocalDeviceIdForRelay()
        const localPairingCode = getLocalPairingCode()
        const vContract = validateInternalInitiateContract({
          sender_device_id: localRelayId,
          sender_device_role: initDeviceRole,
          sender_computer_name: initDeviceName,
          receiver_pairing_code: initReceiverPairingCode,
          local_pairing_code: localPairingCode,
        })
        if (!vContract.ok) {
          return { success: false, error: formatInternalEndpointValidationFailure(vContract, { call: 'initiate' }) }
        }
      }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      const handshakeId = `hs-${randomUUID()}`
      const strictInternalX25519 = initHandshakeType === 'internal'
      const { blocks: contextBlocks, blockPolicyMap: initBlockPolicyMap } = buildContextBlocksFromParamsWithPolicy(rawBlocks, rawMessage)
      const profileIds = initProfileIds ?? (initProfileItems?.map((i) => i.profile_id) ?? [])
      const profileBlocks = profileIds.length > 0
        ? resolveProfileIdsToContextBlocks(profileIds, session, handshakeId, 'initiator')
        : []
      const allBlocks = [...contextBlocks, ...profileBlocks]
      for (let i = 0; i < profileBlocks.length; i++) {
        const profileId = profileIds[i]
        const item = initProfileItems?.find((it) => it.profile_id === profileId)
        if (item?.policy_mode === 'override' && item?.policy) {
          initBlockPolicyMap.set(profileBlocks[i].block_id, item.policy)
        }
      }
      const p2pConfig = getP2PConfig(db)
      const localEndpoint = p2pConfig.local_p2p_endpoint ?? (typeof process !== 'undefined' ? (process as any).env?.BEAP_P2P_ENDPOINT : null) ?? null
      const p2pEndpoint = p2pEndpointParam ?? getEffectiveRelayEndpoint(p2pConfig, localEndpoint) ?? (typeof process !== 'undefined' ? (process as any).env?.BEAP_P2P_ENDPOINT : null) ?? null
      const p2pAuthToken = p2pEndpoint ? randomBytes(32).toString('hex') : null

      let keyAgreementRaw: BeapKeyAgreementMaterial
      try {
        keyAgreementRaw = await ensureKeyAgreementKeys(
          {
            sender_x25519_public_key_b64: (params as any).senderX25519PublicKeyB64 ?? (params as any).key_agreement?.x25519_public_key_b64,
            sender_mlkem768_public_key_b64: (params as any).senderMlkem768PublicKeyB64 ?? (params as any).key_agreement?.mlkem768_public_key_b64,
          },
          { strictDeviceBoundX25519: strictInternalX25519 },
        )
      } catch (e) {
        if (e instanceof BoundKeyAgreementError) {
          return {
            type: 'handshake-initiate-result',
            success: false,
            error: e.message,
            code: e.code,
            handshake_id: handshakeId,
            email_sent: false,
            local_result: { success: false, error: e.message },
            electronGeneratedMlkemSecret: null,
          }
        }
        throw e
      }
      // If the extension provided the ML-KEM secret, store it in the DB record.
      // ensureKeyAgreementKeys sets sender_mlkem768_secret_key_b64=null when a caller-provided public key
      // is used (it assumes the extension holds the secret). We override that here so the Electron-side
      // native decryption path (decryptQBeapPackage) can read the secret from the DB.
      const callerMlkemSecret = (params as any).senderMlkem768SecretKeyB64?.trim() || null
      const keyAgreement = callerMlkemSecret
        ? { ...keyAgreementRaw, sender_mlkem768_secret_key_b64: callerMlkemSecret }
        : keyAgreementRaw

      const { capsule, localBlocks, keypair } = buildInitiateCapsuleWithContent(session, {
        receiverUserId,
        receiverEmail,
        handshake_id: handshakeId,
        ...(allBlocks.length > 0 ? { context_blocks: allBlocks } : {}),
        ...(p2pEndpoint ? { p2p_endpoint: p2pEndpoint } : {}),
        ...(p2pAuthToken ? { p2p_auth_token: p2pAuthToken } : {}),
        sender_x25519_public_key_b64: keyAgreement.sender_x25519_public_key_b64,
        sender_mlkem768_public_key_b64: keyAgreement.sender_mlkem768_public_key_b64,
        ...(initHandshakeType === 'internal' &&
        initDeviceRole &&
        initDeviceName?.trim() &&
        initReceiverPairingCode
          ? {
              initiatorDeviceRole: initDeviceRole,
              initiatorComputerName: initDeviceName.trim(),
              internalReceiverPairingCode: initReceiverPairingCode,
            }
          : {}),
      })

      const canonicalBlockPolicyMap = new Map<string, { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }>()
      for (let i = 0; i < allBlocks.length && i < localBlocks.length; i++) {
        const policy = initBlockPolicyMap.get(allBlocks[i].block_id)
        if (policy) canonicalBlockPolicyMap.set(localBlocks[i].block_id, policy)
      }

      const effectiveAccountId = fromAccountId || session.email || ''

      let emailResult: any = null
      if (effectiveAccountId) {
        // Internal handshakes use the same Delivery Method as external (Email via API
        // or Email as attachment). The receiver_pairing_code embedded in the capsule
        // identifies the intended device at acceptance time; the relay email path does
        // not need to know about it. Internal special-casing is intentionally absent.
        emailResult = await sendCapsuleViaEmail(effectiveAccountId, receiverEmail, capsule)
      }

      let localResult: any = { success: true }
      // Phase 3: for internal handshakes with coordination configured, we push the initiate
      // capsule through the relay instead of requiring a file transfer. The download path
      // remains available as a fallback via `handshake.buildForDownload`.
      let relayDelivery:
        | 'pushed_live'
        | 'queued_recipient_offline'
        | 'coordination_unavailable'
        | 'skipped'
        | null = null
      let relayError: string | null = null
      if (db) {
        // Initiator persists own record via direct insert — NOT the receive pipeline.
        // The pipeline rejects when senderId === localUserId (ownership check).
        localResult = persistInitiatorHandshakeRecord(
          db,
          capsule,
          session,
          localBlocks,
          keypair,
          initPolicySelections,
          canonicalBlockPolicyMap,
          keyAgreement,
        )
        if (localResult.success && (p2pAuthToken || getP2PConfig(db).use_coordination) && receiverEmail) {
          // Registration is blocking: if the relay doesn't know this handshake exists, the
          // accept capsule will 403. Use session.sub (JWT sub claim) — NOT wrdesk_user_id —
          // because the relay extracts sub from the Bearer token for authorization checks.
          const p2pConfig = getP2PConfig(db)
          const localRelayDeviceId = getLocalDeviceIdForRelay()
          const regResult = p2pConfig.use_coordination
            ? await registerHandshakeWithRelay(db, capsule.handshake_id, p2pAuthToken ?? '', receiverEmail, _getOidcToken, {
                initiator_user_id: session.sub,
                acceptor_user_id: coordinationAcceptorUserIdForRegistration(session, receiverEmail, receiverUserId, {
                  explicitInternal: initHandshakeType === 'internal',
                }),
                initiator_email: session.email,
                acceptor_email: receiverEmail,
                handshake_type: initHandshakeType,
                ...(localRelayDeviceId ? { initiator_device_id: localRelayDeviceId } : {}),
                ...(initHandshakeType === 'internal' && initCounterpartyDeviceId?.trim()
                  ? { acceptor_device_id: initCounterpartyDeviceId.trim() }
                  : {}),
              })
            : await registerHandshakeWithRelay(db, capsule.handshake_id, p2pAuthToken ?? '', receiverEmail)
          if (!regResult.success) {
            console.error('[HANDSHAKE] Relay registration failed on initiate:', regResult.error, '— handshake_id:', capsule.handshake_id)
          } else {
            console.log('[HANDSHAKE] Relay registration succeeded on initiate:', capsule.handshake_id)
            /* Trigger: relay registration HTTP 200 — internal same-principal row may now route; retry deferred initial context_sync for this id only. */
            retryDeferredInitialContextSyncForInternalHandshake(db, capsule.handshake_id, session, _getOidcToken)
          }

          // Internal initiates traverse the coordination relay with same-principal
          // routing; external initiates are delivered out-of-band via email/file/USB
          // and never reach this branch (`initHandshakeType === 'internal'` gate
          // below). The relay's per-capsule_type whitelist
          // (packages/coordination-service/src/server.ts:RELAY_ALLOWED_TYPES) includes
          // `'initiate'` and an initiate-specific guard immediately after enforces
          // (a) `handshake_type === 'internal'` on the wire — cross-user initiates
          // are rejected with 400 `initiate_external_not_allowed`,
          // (b) `sender_device_id` and `receiver_device_id` non-empty and distinct —
          // missing fields produce 400 `initiate_missing_routing_fields`,
          // (c) the (sender_device_id, receiver_device_id) pair resolves to a
          // registered same-principal route — no route produces 404
          // `no_route_for_internal_initiate`. The acceptor's WS handler then routes
          // the initiate through the handshake pipeline exactly as a .beap file
          // import would. Both routing fields are populated upstream by
          // `resolvePairingCodeViaCoordination` so the server guards never fire on
          // a healthy client.
          const shouldRelayInitiate =
            initHandshakeType === 'internal' &&
            p2pConfig.use_coordination === true &&
            !!p2pConfig.coordination_url?.trim() &&
            regResult.success
          if (shouldRelayInitiate) {
            const coordTarget = p2pConfig.coordination_url!.trim().replace(/\/$/, '') + '/beap/capsule'
            const enq = enqueueOutboundCapsule(db, capsule.handshake_id, coordTarget, capsule)
            if (!enq.enqueued) {
              console.warn(
                '[HANDSHAKE] Internal initiate enqueue blocked by relay guard:',
                enq.message,
                '— handshake_id:',
                capsule.handshake_id,
              )
              relayDelivery = 'coordination_unavailable'
              relayError = enq.message
            } else {
              try {
                const drain: ProcessOutboundQueueResult = await processOutboundQueue(db, _getOidcToken)
                if (drain.delivered) {
                  relayDelivery = drain.coordinationRelayDelivery ?? 'pushed_live'
                } else {
                  relayDelivery = 'coordination_unavailable'
                  relayError = drain.error ?? drain.last_queue_error ?? 'Coordination delivery did not complete'
                  console.warn(
                    '[HANDSHAKE] Internal initiate relay push failed:',
                    relayError,
                    '— handshake_id:',
                    capsule.handshake_id,
                  )
                }
              } catch (err: any) {
                relayDelivery = 'coordination_unavailable'
                relayError = err?.message ?? String(err)
                console.warn('[HANDSHAKE] Internal initiate relay push threw:', relayError)
              }
            }
          } else if (initHandshakeType === 'internal') {
            // Internal handshake but coordination isn't configured — skip relay push silently.
            relayDelivery = 'skipped'
          }
        }
      } else if (!skipVaultContext) {
        return { success: false, error: 'Vault must be unlocked for contextual handshakes' }
      }

      return {
        type: 'handshake-initiate-result',
        success: localResult.success,
        handshake_id: capsule.handshake_id,
        email_sent: emailResult?.success ?? false,
        email_error: emailResult?.error,
        local_result: localResult,
        // Phase 3: relay_delivery tells the renderer whether the internal initiate capsule
        // was pushed live, queued for the offline peer, or whether coordination was unavailable
        // and the user should fall back to the .beap download path. Null / 'skipped' for
        // external handshakes and for internal handshakes when coordination is not configured.
        relay_delivery: relayDelivery,
        ...(relayError ? { relay_error: relayError } : {}),
        // Non-null when Electron generated the ML-KEM keypair (PQ unavailable in extension at initiate time).
        electronGeneratedMlkemSecret: keyAgreement.sender_mlkem768_secret_key_b64 ?? null,
      }
    }

    case 'handshake.buildForDownload': {
      const {
        receiverUserId: dlReceiverUserId,
        receiverEmail: dlReceiverEmail,
        context_blocks: dlRawBlocks,
        message: dlRawMessage,
        profile_ids: dlProfileIds,
        profile_items: dlProfileItems,
        p2p_endpoint: dlP2PEndpointParam,
        policy_selections: dlPolicySelections,
        handshake_type: dlHandshakeType,
        device_name: dlDeviceName,
        device_role: dlDeviceRole,
        counterparty_device_id: dlCounterpartyDeviceIdRaw,
        counterparty_device_role: dlCounterpartyDeviceRole,
        counterparty_computer_name: dlCounterpartyComputerNameRaw,
        counterparty_pairing_code: dlCounterpartyPairingCode,
      } = params as {
        receiverUserId: string
        receiverEmail: string
        skipVaultContext?: boolean
        context_blocks?: RawBlockWithPolicy[]
        message?: string
        profile_ids?: string[]
        profile_items?: Array<{ profile_id: string; policy_mode?: 'inherit' | 'override'; policy?: { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean } }>
        policy_selections?: { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }
        p2p_endpoint?: string | null
        handshake_type?: 'internal' | 'standard'
        device_name?: string
        device_role?: 'host' | 'sandbox'
        counterparty_device_id?: string
        counterparty_device_role?: 'host' | 'sandbox'
        counterparty_computer_name?: string
        /** See `handshake.initiate` — pairing-code shorthand for internal handshakes. */
        counterparty_pairing_code?: string
      }

      const dlCounterpartyDeviceId = dlCounterpartyDeviceIdRaw
      const dlCounterpartyComputerName = dlCounterpartyComputerNameRaw
      const dlReceiverPairingCode = normalizePairingCode(dlCounterpartyPairingCode ?? null)

      if (!dlReceiverUserId || !dlReceiverEmail) {
        return { success: false, error: 'receiverUserId and receiverEmail are required' }
      }

      if (dlHandshakeType === 'internal') {
        const localRelayIdDl = getLocalDeviceIdForRelay()
        const localPairingCodeDl = getLocalPairingCode()
        const vContractDl = validateInternalInitiateContract({
          sender_device_id: localRelayIdDl,
          sender_device_role: dlDeviceRole,
          sender_computer_name: dlDeviceName,
          receiver_pairing_code: dlReceiverPairingCode,
          local_pairing_code: localPairingCodeDl,
        })
        if (!vContractDl.ok) {
          return { success: false, error: formatInternalEndpointValidationFailure(vContractDl, { call: 'buildForDownload' }) }
        }
      }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      const dlHandshakeId = `hs-${randomUUID()}`
      const dlStrictInternalX25519 = dlHandshakeType === 'internal'
      const { blocks: dlContextBlocks, blockPolicyMap: dlBlockPolicyMap } = buildContextBlocksFromParamsWithPolicy(dlRawBlocks, dlRawMessage)
      const dlProfileIdsList = dlProfileIds ?? (dlProfileItems?.map((i) => i.profile_id) ?? [])
      const dlProfileBlocks = dlProfileIdsList.length > 0
        ? resolveProfileIdsToContextBlocks(dlProfileIdsList, session, dlHandshakeId, 'initiator')
        : []
      const dlAllBlocks = [...dlContextBlocks, ...dlProfileBlocks]
      for (let i = 0; i < dlProfileBlocks.length; i++) {
        const profileId = dlProfileIdsList[i]
        const item = dlProfileItems?.find((it) => it.profile_id === profileId)
        if (item?.policy_mode === 'override' && item?.policy) {
          dlBlockPolicyMap.set(dlProfileBlocks[i].block_id, item.policy)
        }
      }
      const dlP2PConfig = getP2PConfig(db)
      const dlLocalEndpoint = dlP2PConfig.local_p2p_endpoint ?? (typeof process !== 'undefined' ? (process as any).env?.BEAP_P2P_ENDPOINT : null) ?? null
      const dlP2PEndpoint = dlP2PEndpointParam ?? getEffectiveRelayEndpoint(dlP2PConfig, dlLocalEndpoint) ?? (typeof process !== 'undefined' ? (process as any).env?.BEAP_P2P_ENDPOINT : null) ?? null
      const dlP2PAuthToken = dlP2PEndpoint ? randomBytes(32).toString('hex') : null

      let dlKeyAgreementRaw: BeapKeyAgreementMaterial
      try {
        dlKeyAgreementRaw = await ensureKeyAgreementKeys(
          {
            sender_x25519_public_key_b64: (params as any).senderX25519PublicKeyB64 ?? (params as any).key_agreement?.x25519_public_key_b64,
            sender_mlkem768_public_key_b64: (params as any).senderMlkem768PublicKeyB64 ?? (params as any).key_agreement?.mlkem768_public_key_b64,
          },
          { strictDeviceBoundX25519: dlStrictInternalX25519 },
        )
      } catch (e) {
        if (e instanceof BoundKeyAgreementError) {
          return {
            type: 'handshake-build-result',
            success: false,
            error: e.message,
            code: e.code,
            handshake_id: dlHandshakeId,
            capsule_json: null,
            suggested_filename: null,
            electronGeneratedMlkemSecret: null,
          }
        }
        throw e
      }
      // Override ML-KEM secret with caller-provided value so it gets persisted in the DB record.
      const dlCallerMlkemSecret = (params as any).senderMlkem768SecretKeyB64?.trim() || null
      const dlKeyAgreement = dlCallerMlkemSecret
        ? { ...dlKeyAgreementRaw, sender_mlkem768_secret_key_b64: dlCallerMlkemSecret }
        : dlKeyAgreementRaw

      const { capsule, localBlocks, keypair } = buildInitiateCapsuleWithContent(session, {
        receiverUserId: dlReceiverUserId,
        receiverEmail: dlReceiverEmail,
        handshake_id: dlHandshakeId,
        ...(dlAllBlocks.length > 0 ? { context_blocks: dlAllBlocks } : {}),
        ...(dlP2PEndpoint ? { p2p_endpoint: dlP2PEndpoint } : {}),
        ...(dlP2PAuthToken ? { p2p_auth_token: dlP2PAuthToken } : {}),
        sender_x25519_public_key_b64: dlKeyAgreement.sender_x25519_public_key_b64,
        sender_mlkem768_public_key_b64: dlKeyAgreement.sender_mlkem768_public_key_b64,
        ...(dlHandshakeType === 'internal' &&
        dlDeviceRole &&
        dlDeviceName?.trim() &&
        dlReceiverPairingCode
          ? {
              initiatorDeviceRole: dlDeviceRole,
              initiatorComputerName: dlDeviceName.trim(),
              internalReceiverPairingCode: dlReceiverPairingCode,
            }
          : {}),
      })

      const dlCanonicalBlockPolicyMap = new Map<string, { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }>()
      for (let i = 0; i < dlAllBlocks.length && i < localBlocks.length; i++) {
        const policy = dlBlockPolicyMap.get(dlAllBlocks[i].block_id)
        if (policy) dlCanonicalBlockPolicyMap.set(localBlocks[i].block_id, policy)
      }

      const localpart = dlReceiverEmail.split('@')[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'unknown'
      const shortHash = capsule.capsule_hash.slice(0, 8)

      // Persist the initiator capsule locally so the handshakes row exists.
      // Direct insert — NOT the receive pipeline (ownership would reject).
      // If db is null the session/ledger isn't open — fail immediately so the caller
      // knows the capsule should NOT be exported (it would be undeliverable).
      if (!db) {
        return {
          type: 'handshake-build-result',
          success: false,
          error: 'No active session database — please ensure you are logged in before exporting a handshake capsule.',
          handshake_id: capsule.handshake_id,
          capsule_json: null,
          suggested_filename: null,
        }
      }

      const buildLocalResult = persistInitiatorHandshakeRecord(
        db,
        capsule,
        session,
        localBlocks,
        keypair,
        dlPolicySelections,
        dlCanonicalBlockPolicyMap,
        dlKeyAgreement,
      )
      if (!buildLocalResult.success) {
        return {
          type: 'handshake-build-result',
          success: false,
          error: buildLocalResult.error,
          handshake_id: capsule.handshake_id,
          capsule_json: JSON.stringify(capsule),
          suggested_filename: `handshake_${localpart}_${shortHash}.beap`,
        }
      }

      // Register with relay BEFORE returning the capsule so that when the acceptor
      // imports and submits the accept capsule, the relay already knows the routing.
      // We still do this async (non-blocking) because relay registration failure is
      // not fatal for the export — the relay will reject the accept capsule, but the
      // user can retry via email or direct delivery.
      if (dlP2PAuthToken || getP2PConfig(db).use_coordination) {
        const p2pConfig = getP2PConfig(db)
        const localRelayDeviceId = getLocalDeviceIdForRelay()
        // Use session.sub (JWT sub) — relay always authorizes by sub, not wrdesk_user_id.
        const registerPromise = p2pConfig.use_coordination
          ? registerHandshakeWithRelay(db, capsule.handshake_id, dlP2PAuthToken ?? '', dlReceiverEmail, _getOidcToken, {
              initiator_user_id: session.sub,
              acceptor_user_id: coordinationAcceptorUserIdForRegistration(session, dlReceiverEmail, dlReceiverUserId, {
                explicitInternal: dlHandshakeType === 'internal',
              }),
              initiator_email: session.email,
              acceptor_email: dlReceiverEmail,
              handshake_type: dlHandshakeType,
              ...(localRelayDeviceId ? { initiator_device_id: localRelayDeviceId } : {}),
              ...(dlHandshakeType === 'internal' && dlCounterpartyDeviceId?.trim()
                ? { acceptor_device_id: dlCounterpartyDeviceId.trim() }
                : {}),
            })
          : registerHandshakeWithRelay(db, capsule.handshake_id, dlP2PAuthToken ?? '', dlReceiverEmail)

        await registerPromise.then((result) => {
          if (!result.success) {
            console.error('[HANDSHAKE] Relay registration failed on buildForDownload:', result.error, '— handshake_id:', capsule.handshake_id)
          } else {
            console.log('[HANDSHAKE] Relay registration succeeded on buildForDownload:', capsule.handshake_id)
            /* Same trigger as initiate relay reg — single-handshake retry for deferred context_sync. */
            retryDeferredInitialContextSyncForInternalHandshake(db, capsule.handshake_id, session, _getOidcToken)
          }
          // Initiate capsule is NOT sent via relay — only file/email/USB. Relay used after accept.
        }).catch((err: any) => {
          console.error('[HANDSHAKE] Relay registration threw on buildForDownload:', err?.message)
        })
      }

      return {
        type: 'handshake-build-result',
        success: true,
        handshake_id: capsule.handshake_id,
        capsule_json: JSON.stringify(capsule),
        suggested_filename: `handshake_${localpart}_${shortHash}.beap`,
        // Non-null when Electron generated the ML-KEM keypair (PQ unavailable in extension at buildForDownload time).
        // Extension MUST call storeLocalMlkemSecret(handshake_id, electronGeneratedMlkemSecret) on receipt.
        electronGeneratedMlkemSecret: dlKeyAgreement.sender_mlkem768_secret_key_b64 ?? null,
      }
    }

    case 'handshake.accept': {
      const { handshake_id, sharing_mode: requested_sharing_mode, fromAccountId, context_blocks: receiverRawBlocks, profile_ids: receiverProfileIds, profile_items: receiverProfileItems, p2p_endpoint: p2pEndpointParam, policy_selections: acceptPolicySelections, device_name: acceptDeviceName, device_role: acceptDeviceRole, local_pairing_code_typed: acceptTypedPairingCode } = params as {
        handshake_id: string
        sharing_mode: 'receive-only' | 'reciprocal'
        fromAccountId: string
        /** Required for normal (non-internal) accepts — extension device X25519 from chrome.storage. */
        senderX25519PublicKeyB64?: string | null
        key_agreement?: { x25519_public_key_b64?: string | null; mlkem768_public_key_b64?: string | null }
        context_blocks?: RawBlockWithPolicy[]
        profile_ids?: string[]
        profile_items?: Array<{ profile_id: string; policy_mode?: 'inherit' | 'override'; policy?: { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean } }>
        p2p_endpoint?: string | null
        policy_selections?: { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }
        device_name?: string
        device_role?: 'host' | 'sandbox'
        /**
         * Internal handshakes only — the 6-digit pairing code the user typed in the
         * AcceptHandshakeModal (this device's own code). Must equal the capsule's
         * `receiver_pairing_code` (persisted as `internal_peer_pairing_code` on the
         * record). Required for new internal capsules; ignored for legacy capsules
         * that only carry `internal_peer_device_id`.
         */
        local_pairing_code_typed?: string
      }

      if (!handshake_id || !requested_sharing_mode) {
        return { success: false, error: 'handshake_id and sharing_mode are required' }
      }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      let record = getHandshakeRecord(db, handshake_id)
      if (!record) {
        return { success: false, error: 'Handshake not found', reason: ReasonCode.HANDSHAKE_NOT_FOUND }
      }
      if (record.state !== HS.PENDING_ACCEPT && record.state !== HS.PENDING_REVIEW) {
        return { success: false, error: `Handshake is in state ${record.state}, expected PENDING_ACCEPT or PENDING_REVIEW` }
      }

      // LAYER 1 — Receiver email validation (HIGH ASSURANCE)
      const receiverCheck = validateReceiverEmail(record.receiver_email, session.email)
      if (!receiverCheck.valid) {
        return {
          success: false,
          error: receiverCheck.reason ?? 'Handshake rejection: Your authenticated identity does not match the intended recipient.',
          reason: ReasonCode.POLICY_VIOLATION,
        }
      }

      // Clamp sharing_mode: if the initiator did not allow reciprocal, force receive-only
      const sharing_mode: 'receive-only' | 'reciprocal' =
        requested_sharing_mode === 'reciprocal' && !record.reciprocal_allowed
          ? 'receive-only'
          : requested_sharing_mode

      // Normal (cross-principal) accept: require acceptor X25519 up front — same params
      // `ensureKeyAgreementKeys` reads later; avoids silent ephemeral fallback (see KEY-AGREEMENT log).
      if (record.handshake_type !== 'internal') {
        if (!acceptorX25519FromHandshakeAcceptParams(params)) {
          logNormalAcceptX25519BindingFailure({
            handshake_id,
            local_role: record.local_role,
            handshake_type: record.handshake_type ?? null,
            params,
            ingress: 'handleHandshakeRPC.handshake.accept.preflight',
          })
          return handshakeAcceptMissingX25519Result(handshake_id)
        }
      }

      const initiatorUserId = record.initiator.wrdesk_user_id
      let initiatorEmail = record.initiator.email
      // For internal handshakes, initiator email is always the same as session email
      if (!initiatorEmail && record.handshake_type === 'internal') {
        initiatorEmail = session.email
      }

      if (record.handshake_type === 'internal') {
        const acceptLocalDev = getLocalDeviceIdForRelay()
        if (!acceptLocalDev?.trim()) {
          return {
            success: false,
            error:
              'INTERNAL_ENDPOINT_INCOMPLETE: This device has no coordination identity. Open Settings → Orchestrator mode to check the device configuration.',
          }
        }
        // The initiator side comes from the persisted record — if it's incomplete by
        // the time the acceptor reads it, the bug is upstream (initiate or relay
        // ingestion). Treat as counterparty for messaging so we surface the
        // "internal error, please report" + ERROR log path instead of pointing the
        // accepting user to a Settings screen they can't fix.
        const vInit = validateInternalEndpointFields(
          'sender',
          record.initiator_coordination_device_id,
          record.initiator_device_role,
          record.initiator_device_name,
        )
        if (!vInit.ok) {
          return { success: false, error: formatInternalEndpointValidationFailure(vInit, { call: 'accept', handshake_id }) }
        }
        const vAcc = validateInternalEndpointFields(
          'acceptor',
          acceptLocalDev,
          acceptDeviceRole,
          acceptDeviceName,
        )
        if (!vAcc.ok) {
          return { success: false, error: formatInternalEndpointValidationFailure(vAcc, { call: 'accept', handshake_id }) }
        }
        const pairAcc = validateInternalEndpointPairDistinct(
          {
            deviceId: record.initiator_coordination_device_id!.trim(),
            deviceRole: record.initiator_device_role!,
            computerName: record.initiator_device_name!.trim(),
          },
          {
            deviceId: acceptLocalDev.trim(),
            deviceRole: acceptDeviceRole!,
            computerName: acceptDeviceName!.trim(),
          },
        )
        if (!pairAcc.ok) {
          return { success: false, error: formatInternalEndpointValidationFailure(pairAcc, { call: 'accept', handshake_id }) }
        }
        // Peer-device check.
        //
        // New capsules carry `receiver_pairing_code` (persisted as
        // `internal_peer_pairing_code`) — verify by string-equality against the user's
        // typed code, which must equal this device's own pairing code from
        // orchestratorModeStore. Typing the code is a deliberate UX choice: the user
        // confirms they're on the right device by reading the code from Settings.
        //
        // Legacy capsules (created before the pairing-code refactor) only carry
        // `internal_peer_device_id` — fall back to the original UUID-equality check
        // against the local instance id.
        const expectedReceiverCode = record.internal_peer_pairing_code?.trim() ?? ''
        const localOwnCode = getLocalPairingCode()
        const typedCode = normalizePairingCode(acceptTypedPairingCode ?? null)
        if (expectedReceiverCode) {
          if (!typedCode || !isValidPairingCodeFormat(typedCode)) {
            return {
              success: false,
              error:
                `${INTERNAL_ERROR_CODES.INTERNAL_PAIRING_CODE_INVALID}: Enter the 6-digit pairing code shown in this device's Settings → Orchestrator mode to accept the handshake.`,
            }
          }
          if (typedCode !== expectedReceiverCode) {
            const expectedDisplay = formatPairingCodeForDisplay(expectedReceiverCode)
            const localDisplay = localOwnCode
              ? formatPairingCodeForDisplay(localOwnCode)
              : 'unknown'
            return {
              success: false,
              error:
                `${INTERNAL_ERROR_CODES.INTERNAL_PEER_DEVICE_MISMATCH}: This handshake was sent to a device with pairing code ${expectedDisplay}. This device's code is ${localDisplay}. Open the capsule on the other device.`,
            }
          }
          // Defense in depth: if we know the local pairing code from the orchestrator
          // store, the typed code MUST also equal it. Catches a user who typed the
          // sender's intended code but on the wrong device — same string, different
          // physical machine.
          if (localOwnCode && typedCode !== localOwnCode) {
            const expectedDisplay = formatPairingCodeForDisplay(expectedReceiverCode)
            const localDisplay = formatPairingCodeForDisplay(localOwnCode)
            return {
              success: false,
              error:
                `${INTERNAL_ERROR_CODES.INTERNAL_PEER_DEVICE_MISMATCH}: This handshake was sent to a device with pairing code ${expectedDisplay}. This device's code is ${localDisplay}. Open the capsule on the other device.`,
            }
          }
        } else if (
          record.internal_peer_device_id?.trim() &&
          acceptLocalDev.trim() !== record.internal_peer_device_id.trim()
        ) {
          return {
            success: false,
            error:
              `${INTERNAL_ERROR_CODES.INTERNAL_PEER_DEVICE_MISMATCH}: This capsule was created for a different device. Open it on the device whose pairing code matches the one used to create it.`,
          }
        }

        // ─── Acceptor-side coordination-identity repair ──────────────────
        // Pairing-code-routed initiates carry NO receiver_* fields on the wire
        // (validateInternalInitiateCapsuleWire at internalPersistence.ts:111-121
        // accepts that shape), so buildInitiateRecord (enforcement.ts:695-714)
        // persists `acceptor_coordination_device_id`, `acceptor_device_role`,
        // and `acceptor_device_name` as null. If we let buildAcceptCapsule and
        // submitCapsuleViaRpc proceed against that incomplete record, the
        // ACCEPTED-state row written by the receive pipeline carries
        // `internal_coordination_identity_complete=false`, and the subsequent
        // tryEnqueueContextSync (line 2139, inside the post-accept setImmediate)
        // hits the INTERNAL_RELAY_ENDPOINTS_INCOMPLETE gate at
        // contextSyncEnqueue.ts:91-95 (because internalRelayCapsuleWireOptsFromRecord
        // at internalCoordinationWire.ts:34-40 early-returns null when
        // internal_coordination_identity_complete !== true). The handshake then
        // stalls in ACCEPTED forever.
        //
        // Repair the in-memory record with the local device's coordination
        // identity here — BEFORE buildAcceptCapsule — and persist via
        // updateHandshakeRecord, which auto-runs finalizeInternalHandshakePersistence
        // (db.ts:1639-1640) and flips internal_coordination_identity_complete to
        // true. submitCapsuleViaRpc's downstream buildAcceptRecord
        // (enforcement.ts:720-786) preserves these acceptor_* columns via its
        // `...existing` spread, so the repair survives the ACCEPTED-state write.
        //
        // All three input values are already validated:
        //   - acceptLocalDev:    non-empty per the line 1630-1636 guard above.
        //   - acceptDeviceRole:  validated by validateInternalEndpointFields at 1651.
        //   - acceptDeviceName:  same.
        //
        // Pre-existing non-empty acceptor_* values (legacy UUID-routed initiate
        // path where receiver_* came in on the wire) are preserved — only fill
        // gaps. A mismatch between the persisted value and the local device's
        // identity is logged at WARN; we do not overwrite, because the legacy
        // path's value is the authoritative one signed into the initiate.
        const repairFields = {
          acceptor_coordination_device_id: acceptLocalDev.trim(),
          acceptor_device_role: acceptDeviceRole as 'host' | 'sandbox',
          acceptor_device_name: acceptDeviceName!.trim(),
        }
        const acceptRepairPatch: Partial<HandshakeRecord> = {}
        if (!record.acceptor_coordination_device_id?.trim()) {
          acceptRepairPatch.acceptor_coordination_device_id = repairFields.acceptor_coordination_device_id
        } else if (record.acceptor_coordination_device_id.trim() !== repairFields.acceptor_coordination_device_id) {
          console.warn(
            '[HANDSHAKE-DEBUG] Internal acceptor identity repair: acceptor_coordination_device_id already populated and differs from local device — preserving persisted value',
            { handshake_id, persisted: record.acceptor_coordination_device_id.trim(), local: repairFields.acceptor_coordination_device_id },
          )
        }
        if (!record.acceptor_device_role) {
          acceptRepairPatch.acceptor_device_role = repairFields.acceptor_device_role
        } else if (record.acceptor_device_role !== repairFields.acceptor_device_role) {
          console.warn(
            '[HANDSHAKE-DEBUG] Internal acceptor identity repair: acceptor_device_role already populated and differs — preserving persisted value',
            { handshake_id, persisted: record.acceptor_device_role, local: repairFields.acceptor_device_role },
          )
        }
        if (!record.acceptor_device_name?.trim()) {
          acceptRepairPatch.acceptor_device_name = repairFields.acceptor_device_name
        } else if (record.acceptor_device_name.trim() !== repairFields.acceptor_device_name) {
          console.warn(
            '[HANDSHAKE-DEBUG] Internal acceptor identity repair: acceptor_device_name already populated and differs — preserving persisted value',
            { handshake_id, persisted: record.acceptor_device_name.trim(), local: repairFields.acceptor_device_name },
          )
        }

        if (Object.keys(acceptRepairPatch).length > 0) {
          const repaired: HandshakeRecord = { ...record, ...acceptRepairPatch }
          // updateHandshakeRecord runs finalizeInternalHandshakePersistence
          // (db.ts:1640) which recomputes internal_routing_key and
          // internal_coordination_identity_complete based on the new values.
          // Let DB exceptions propagate — we do NOT want to silently degrade
          // the way the post-submit try/catch at 1984-2018 currently does.
          updateHandshakeRecord(db, repaired)
          const reread = getHandshakeRecord(db, handshake_id)
          if (!reread) {
            return {
              success: false,
              error: 'INTERNAL_IDENTITY_INCOMPLETE',
              detail: { missing: ['record_disappeared_after_repair'] },
            } as any
          }
          record = reread
        }

        // Hard gate: after repair, identity MUST be complete. The only way to
        // reach this branch with completeness still false is if one of the
        // initiator-side fields (initiator_coordination_device_id,
        // initiator_device_role, initiator_device_name) is missing on the
        // persisted record — which means the initiate import was malformed
        // and the renderer needs an explicit failure rather than a silently
        // half-built ACCEPTED row.
        if (!isInternalCoordinationIdentityComplete(record)) {
          const missing: string[] = []
          if (!record.initiator_coordination_device_id?.trim()) missing.push('initiator_coordination_device_id')
          if (!record.acceptor_coordination_device_id?.trim()) missing.push('acceptor_coordination_device_id')
          if (!record.initiator_device_role) missing.push('initiator_device_role')
          if (!record.acceptor_device_role) missing.push('acceptor_device_role')
          if (!record.initiator_device_name?.trim()) missing.push('initiator_device_name')
          if (!record.acceptor_device_name?.trim()) missing.push('acceptor_device_name')
          console.error(
            '[HANDSHAKE] INTERNAL_IDENTITY_INCOMPLETE after acceptor repair — refusing to build accept capsule',
            { handshake_id, missing },
          )
          return {
            success: false,
            error: 'INTERNAL_IDENTITY_INCOMPLETE',
            detail: { missing },
          } as any
        }
      }

      // 1. Query initiator's echoed blocks (from initiate capsule)
      let initiatorBlocks: ContextBlockForCommitment[] = []
      try {
        const stored = queryContextBlocks(db, { handshake_id })
        if (stored.length > 0) {
          initiatorBlocks = stored.map(b => ({
            block_id: b.block_id,
            block_hash: b.block_hash,
            scope_id: b.scope_id ?? undefined,
            type: b.type,
            content: b.payload_ref,
          }))
        }
      } catch {
        /* best-effort */
      }

      // 2. Build receiver's blocks: ad-hoc from client + Vault Profiles (resolved server-side)
      const profileIds = receiverProfileIds ?? receiverProfileItems?.map((i) => i.profile_id) ?? []
      const { blocks: receiverAdhocBlocks, blockPolicyMap: adhocBlockPolicyMap } = buildContextBlocksFromParamsWithPolicy(receiverRawBlocks, undefined)
      const receiverProfileBlocks = resolveProfileIdsToContextBlocks(profileIds, session, handshake_id)
      if (profileIds.length > 0) {
        console.log('[Handshake Accept] Profile resolution:', { profileIds: profileIds.length, profileBlocks: receiverProfileBlocks.length })
      }
      const receiverBlocks = [...receiverAdhocBlocks, ...receiverProfileBlocks]
      for (const b of receiverBlocks) {
        if (!b.scope_id) (b as any).scope_id = 'acceptor'
      }

      // Per-item policy map: adhoc blocks + profile blocks (profile_items zip with resolved blocks)
      const receiverBlockPolicyMap = new Map<string, { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }>(adhocBlockPolicyMap)
      if (receiverProfileItems?.length && receiverProfileItems.length === receiverProfileBlocks.length) {
        for (let i = 0; i < receiverProfileBlocks.length; i++) {
          const item = receiverProfileItems[i]
          if (item?.policy_mode === 'override' && item?.policy) {
            receiverBlockPolicyMap.set(receiverProfileBlocks[i].block_id, item.policy)
          }
        }
      }

      // 3. Merge: initiator echoed + receiver's new blocks. Commitment covers all.
      const acceptContextBlocks = [...initiatorBlocks, ...receiverBlocks]
      const { computeContextCommitment: computeCommitment } = await import('./contextCommitment')
      const acceptContextCommitment = acceptContextBlocks.length > 0 ? computeCommitment(acceptContextBlocks) : null

      const acceptP2PConfig = getP2PConfig(db)
      const acceptLocalEndpoint = acceptP2PConfig.local_p2p_endpoint ?? (typeof process !== 'undefined' ? (process as any).env?.BEAP_P2P_ENDPOINT : null) ?? null
      const p2pEndpoint = p2pEndpointParam ?? getEffectiveRelayEndpoint(acceptP2PConfig, acceptLocalEndpoint) ?? (typeof process !== 'undefined' ? (process as any).env?.BEAP_P2P_ENDPOINT : null) ?? null
      const p2pAuthToken = p2pEndpoint ? randomBytes(32).toString('hex') : null

      let acceptKeyAgreementRaw: BeapKeyAgreementMaterial
      try {
        acceptKeyAgreementRaw = await ensureKeyAgreementKeys(
          {
            sender_x25519_public_key_b64: acceptorX25519FromHandshakeAcceptParams(params),
            sender_mlkem768_public_key_b64: (params as any).senderMlkem768PublicKeyB64 ?? (params as any).key_agreement?.mlkem768_public_key_b64,
          },
          {
            strictDeviceBoundX25519: record.handshake_type === 'internal',
            forbidEphemeralX25519ForNormalAccept: record.handshake_type !== 'internal',
            normalAcceptX25519BindingDiag:
              record.handshake_type !== 'internal'
                ? {
                    handshake_id,
                    local_role: record.local_role,
                    handshake_type: record.handshake_type ?? null,
                    rawParams: params,
                    ingress: 'handleHandshakeRPC.handshake.accept.ensureKeyAgreementKeys',
                  }
                : undefined,
          },
        )
      } catch (e) {
        if (e instanceof BoundKeyAgreementError) {
          return {
            type: 'handshake-accept-result',
            success: false,
            error: e.message,
            code: e.code,
            handshake_id,
            email_sent: false,
            email_error: undefined,
            local_result: { success: false, error: e.message },
            context_sync_status: 'skipped',
            electronGeneratedMlkemSecret: null,
            message: undefined,
          }
        }
        throw e
      }
      // Override ML-KEM secret with caller-provided value so it gets persisted in the DB record.
      const acceptCallerMlkemSecret = (params as any).senderMlkem768SecretKeyB64?.trim() || null
      const acceptKeyAgreement = acceptCallerMlkemSecret
        ? { ...acceptKeyAgreementRaw, sender_mlkem768_secret_key_b64: acceptCallerMlkemSecret }
        : acceptKeyAgreementRaw

      console.log('[HANDSHAKE-ACCEPT] Key agreement for accept capsule:', {
        handshake_id,
        hasX25519: !!acceptKeyAgreement.sender_x25519_public_key_b64?.trim(),
        x25519Len: acceptKeyAgreement.sender_x25519_public_key_b64?.length ?? 0,
        hasMlkem: !!acceptKeyAgreement.sender_mlkem768_public_key_b64?.trim(),
        mlkemLen: acceptKeyAgreement.sender_mlkem768_public_key_b64?.length ?? 0,
      })

      console.log('[HANDSHAKE-ACCEPT-BUILD] Keys going into accept capsule:', {
        x25519: acceptKeyAgreement.sender_x25519_public_key_b64?.substring(0, 20) || 'MISSING',
        x25519Len: acceptKeyAgreement.sender_x25519_public_key_b64?.length || 0,
        mlkem: acceptKeyAgreement.sender_mlkem768_public_key_b64?.substring(0, 20) || 'MISSING',
        mlkemLen: acceptKeyAgreement.sender_mlkem768_public_key_b64?.length || 0,
      })

      const { capsule, keypair } = buildAcceptCapsule(session, {
        handshake_id,
        initiatorUserId,
        initiatorEmail,
        sharing_mode,
        context_blocks: acceptContextBlocks,
        context_commitment: acceptContextCommitment,
        initiator_capsule_hash: record.last_capsule_hash_received,
        ...(p2pEndpoint ? { p2p_endpoint: p2pEndpoint } : {}),
        ...(p2pAuthToken ? { p2p_auth_token: p2pAuthToken } : {}),
        sender_x25519_public_key_b64: acceptKeyAgreement.sender_x25519_public_key_b64,
        sender_mlkem768_public_key_b64: acceptKeyAgreement.sender_mlkem768_public_key_b64,
        initiatorCoordinationDeviceId: record.initiator_coordination_device_id?.trim() ?? undefined,
        isInternalHandshake: record.handshake_type === 'internal',
        ...(record.handshake_type === 'internal'
          ? {
              senderDeviceRole: acceptDeviceRole,
              senderComputerName: acceptDeviceName,
              receiverDeviceRole: record.initiator_device_role ?? undefined,
              receiverComputerName: record.initiator_device_name?.trim() ?? undefined,
            }
          : {}),
      })
      console.log('[ACCEPT-1] Accept capsule built for:', handshake_id)
      updateHandshakeSigningKeys(db, handshake_id, {
        local_public_key: keypair.publicKey,
        local_private_key: keypair.privateKey,
      })

      const recBeapMerge = getHandshakeRecord(db, handshake_id)
      if (recBeapMerge) {
        updateHandshakeRecord(db, {
          ...recBeapMerge,
          local_x25519_private_key_b64:
            acceptKeyAgreement.sender_x25519_private_key_b64 ?? recBeapMerge.local_x25519_private_key_b64 ?? null,
          local_x25519_public_key_b64: acceptKeyAgreement.sender_x25519_public_key_b64,
          local_mlkem768_secret_key_b64:
            acceptKeyAgreement.sender_mlkem768_secret_key_b64 ?? recBeapMerge.local_mlkem768_secret_key_b64 ?? null,
          local_mlkem768_public_key_b64: acceptKeyAgreement.sender_mlkem768_public_key_b64,
        })
      }

      // 4. Store initiator block stubs (content NULL, status pending) + receiver blocks (content + pending_delivery)
      const hasAcceptPolicy = acceptPolicySelections && (
        (acceptPolicySelections as { ai_processing_mode?: string }).ai_processing_mode !== undefined ||
        (acceptPolicySelections as { cloud_ai?: boolean }).cloud_ai !== undefined ||
        (acceptPolicySelections as { internal_ai?: boolean }).internal_ai !== undefined
      )
      if (hasAcceptPolicy) {
        updateHandshakePolicySelections(db, handshake_id, acceptPolicySelections!)
      }
      const relationshipId = deriveRelationshipId(
        initiatorUserId,
        session.wrdesk_user_id,
        initiatorUserId === session.wrdesk_user_id ? handshake_id : undefined,
      )
      const baseline = hasAcceptPolicy
        ? baselineFromPolicySelections(acceptPolicySelections, record.effective_policy)
        : baselineFromHandshake(record)

      const buildGovernanceForInitiatorBlock = (b: { block_id: string; type: string; scope_id?: string | null }): ContextItemGovernance => {
        const isMsg = b.type === 'message' || b.block_id?.startsWith('ctx-msg')
        if (isMsg) {
          return createMessageGovernance({
            publisher_id: initiatorUserId,
            sender_wrdesk_user_id: initiatorUserId,
          })
        }
        return createDefaultGovernance({
          origin: 'remote_peer',
          usage_policy: { ...baseline },
          provenance: { publisher_id: initiatorUserId, sender_wrdesk_user_id: initiatorUserId },
        })
      }

      const buildGovernanceForReceiverBlock = (b: { block_id: string; type: string; scope_id?: string | null; profileSensitive?: boolean }): ContextItemGovernance => {
        const isMsg = b.type === 'message' || b.block_id?.startsWith('ctx-msg')
        if (isMsg) {
          return createMessageGovernance({
            publisher_id: session.wrdesk_user_id,
            sender_wrdesk_user_id: session.wrdesk_user_id,
          })
        }
        // Per-item policy: override wins over global default (Phase 2)
        const itemPolicy = receiverBlockPolicyMap.get(b.block_id)
        const effectiveBaseline = itemPolicy
          ? baselineFromPolicySelections(itemPolicy, record.effective_policy)
          : baseline
        const usagePolicy: UsagePolicy = {
          ...effectiveBaseline,
          ...((b as any).profileSensitive === true ? { sensitive: true } : {}),
        }
        return createDefaultGovernance({
          origin: 'local',
          usage_policy: usagePolicy,
          provenance: { publisher_id: session.wrdesk_user_id, sender_wrdesk_user_id: session.wrdesk_user_id },
        })
      }

      for (const block of initiatorBlocks) {
        insertContextStoreEntry(db, {
          block_id: block.block_id,
          block_hash: block.block_hash,
          handshake_id: handshake_id,
          relationship_id: relationshipId,
          scope_id: block.scope_id ?? null,
          publisher_id: initiatorUserId,
          type: block.type,
          content: null,
          status: 'pending',
          valid_until: null,
          ingested_at: null,
          superseded: 0,
          governance_json: JSON.stringify(buildGovernanceForInitiatorBlock(block)),
        })
      }
      for (const block of receiverBlocks) {
        const contentStr = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
        insertContextStoreEntry(db, {
          block_id: block.block_id,
          block_hash: block.block_hash,
          handshake_id: handshake_id,
          relationship_id: relationshipId,
          scope_id: block.scope_id ?? null,
          publisher_id: session.wrdesk_user_id,
          type: block.type,
          content: contentStr,
          status: 'pending_delivery',
          valid_until: null,
          ingested_at: null,
          superseded: 0,
          governance_json: JSON.stringify(buildGovernanceForReceiverBlock(block)),
        })
      }

      let emailResult: any = null
      if (fromAccountId && initiatorEmail) {
        emailResult = await sendCapsuleViaEmail(fromAccountId, initiatorEmail, capsule)
      }

      const localResult = await submitCapsuleViaRpc(capsule, db, session)
      console.log('[ACCEPT-2] submitCapsuleViaRpc result:', JSON.stringify(localResult))

      const postAcceptRecord = localResult.success && db ? getHandshakeRecord(db, handshake_id) : null
      console.log(
        '[HANDSHAKE-DEBUG] Accept completed for',
        handshake_id,
        '- state:',
        postAcceptRecord?.state ?? '(no record)',
        'localResult.success:',
        localResult.success,
      )

      if (localResult.success && db) {
        try {
          const accCoordDev = getLocalDeviceIdForRelay()
          if (record.handshake_type === 'internal' && accCoordDev?.trim()) {
            db.prepare(`
            UPDATE handshakes
            SET acceptor_device_name = ?,
                acceptor_device_role = ?,
                acceptor_coordination_device_id = ?
            WHERE handshake_id = ?
          `).run(
            acceptDeviceName || null,
            acceptDeviceRole || null,
            accCoordDev.trim(),
            handshake_id,
          )
          } else if (acceptDeviceName || acceptDeviceRole) {
            db.prepare(`
            UPDATE handshakes
            SET acceptor_device_name = ?,
                acceptor_device_role = ?
            WHERE handshake_id = ?
          `).run(acceptDeviceName || null, acceptDeviceRole || null, handshake_id)
          }
        } catch (e) {
          console.warn('Could not save acceptor device metadata:', e)
        }
        // Refresh record from DB after accept ingest (captures p2p_endpoint update + internal routing flags)
        const refreshed = getHandshakeRecord(db, handshake_id)
        if (refreshed) {
          record = refreshed
          refreshInternalHandshakePersistenceFlags(db, handshake_id)
          record = getHandshakeRecord(db, handshake_id) ?? record
        }
      }

      // For internal handshakes, initiator email is always the same as session email
      if (!initiatorEmail && record.handshake_type === 'internal') {
        initiatorEmail = session.email
      }

      const _acceptPostP2pCfg = db ? getP2PConfig(db) : null
      const use_coordination_flag = !!getP2PConfig(db).use_coordination
      const _acceptWillScheduleRelay =
        !!(localResult.success && (p2pAuthToken || _acceptPostP2pCfg?.use_coordination) && initiatorEmail)
      console.log('[HANDSHAKE-DEBUG] Post-accept relay branch:', {
        handshake_id,
        willScheduleSetImmediate: _acceptWillScheduleRelay,
        localResultSuccess: localResult.success,
        hasP2pAuthToken: !!p2pAuthToken,
        use_coordination: !!_acceptPostP2pCfg?.use_coordination,
        hasInitiatorEmail: !!initiatorEmail,
        recordP2pEndpoint: record.p2p_endpoint?.trim() ? '(set)' : '(empty)',
      })

      console.log('[ACCEPT-3] Gate values:', {
        success: localResult?.success,
        p2pAuthToken: p2pAuthToken ? 'SET' : 'NULL',
        use_coordination: use_coordination_flag,
        initiatorEmail: initiatorEmail || 'NULL',
        p2p_endpoint: record?.p2p_endpoint || 'NULL',
        handshake_type: record?.handshake_type,
        handshake_id,
      })

      if (localResult.success && (p2pAuthToken || getP2PConfig(db).use_coordination) && initiatorEmail) {
        setImmediate(async () => {
          console.log('[ACCEPT-4] setImmediate RUNNING for:', handshake_id)
          console.log('[HANDSHAKE-DEBUG] setImmediate(post-accept relay) started for', handshake_id)
          const p2pConfig = getP2PConfig(db)
          const coordinationInitiatorUserId =
            record.initiator?.sub || record.initiator?.wrdesk_user_id || record.initiator?.email
          console.log('[ACCEPT-RELAY-REG]', {
            initiator_user_id: coordinationInitiatorUserId,
            acceptor_user_id: session.sub,
            same_principal: coordinationInitiatorUserId === session.sub,
            p2p_endpoint: record.p2p_endpoint,
            initiatorEmail: initiatorEmail,
          })
          console.log('[ACCEPT-5] About to register with relay')
          const acceptLocalDeviceId = getLocalDeviceIdForRelay()
          const regResult = p2pConfig.use_coordination
            ? await registerHandshakeWithRelay(db, handshake_id, p2pAuthToken ?? '', initiatorEmail, _getOidcToken, {
                initiator_user_id: coordinationInitiatorUserId,
                acceptor_user_id: session.sub,
                initiator_email: initiatorEmail,
                acceptor_email: session.email,
                handshake_type: record.handshake_type ?? undefined,
                ...(acceptLocalDeviceId ? { acceptor_device_id: acceptLocalDeviceId } : {}),
                ...(record.initiator_coordination_device_id?.trim()
                  ? { initiator_device_id: record.initiator_coordination_device_id.trim() }
                  : {}),
              })
            : await registerHandshakeWithRelay(db, handshake_id, p2pAuthToken ?? '', initiatorEmail)
          console.log('[ACCEPT-6] Relay registration result:', JSON.stringify(regResult))
          if (!regResult.success) {
            console.error('[HANDSHAKE] Relay registration failed on accept:', regResult.error, '— handshake_id:', handshake_id)
            console.log('[HANDSHAKE-DEBUG] Relay registration failed — skipping accept enqueue and context_sync for', handshake_id)
            return
          }
          console.log('[HANDSHAKE] Relay registration succeeded on accept:', handshake_id)
          /* Trigger: post-accept relay register-handshake 200 — may unblock a prior deferred initial context_sync for this id. */
          retryDeferredInitialContextSyncForInternalHandshake(db, handshake_id, session, _getOidcToken)
          // Enqueue accept capsule for relay delivery to initiator.
          //
          // The wire `p2p_endpoint` from the initiate is a routing hint, not a
          // hard requirement: coordination mode actually delivers via the local
          // `coordination_url`/beap/capsule (see processOutboundQueue). If the
          // initiator's wire didn't carry `p2p_endpoint` (e.g. coordination
          // wasn't yet configured at initiate time, or the field was stripped
          // somewhere upstream), the accept capsule must STILL be enqueued so
          // the roundtrip can complete — otherwise the initiator never learns
          // about the acceptance and the handshake silently dies in
          // PENDING_ACCEPT forever. Synthesise the coordination URL here as a
          // safe fallback so that condition cannot break the roundtrip.
          const recordedTargetEndpoint = record.p2p_endpoint?.trim()
          const coordinationFallbackEndpoint =
            !recordedTargetEndpoint && p2pConfig.use_coordination && p2pConfig.coordination_url?.trim()
              ? `${p2pConfig.coordination_url.trim().replace(/\/$/, '')}/beap/capsule`
              : null
          const targetEndpoint = recordedTargetEndpoint || coordinationFallbackEndpoint
          if (targetEndpoint) {
            if (!recordedTargetEndpoint && coordinationFallbackEndpoint) {
              console.warn(
                '[HANDSHAKE-DEBUG] record.p2p_endpoint empty — falling back to coordination URL for accept relay:',
                handshake_id,
                'fallback:',
                coordinationFallbackEndpoint,
              )
            }
            try {
              console.log('[ACCEPT-7] Enqueue target:', targetEndpoint)
              console.log('[HANDSHAKE-DEBUG] Enqueueing accept capsule for relay delivery', handshake_id, 'target:', targetEndpoint)
              const enqAccept = enqueueOutboundCapsule(db, handshake_id, targetEndpoint, capsule)
              if (!enqAccept.enqueued) {
                console.warn(
                  '[HANDSHAKE] Accept capsule enqueue blocked by internal relay guard:',
                  enqAccept.message,
                )
              } else {
                console.log('[HANDSHAKE-DEBUG] Accept capsule enqueued, calling processOutboundQueue', handshake_id)
              }
            } catch (err: any) {
              console.warn('[P2P] Enqueue accept capsule failed:', err?.message)
              console.log('[HANDSHAKE-DEBUG] Accept capsule enqueue threw:', err?.message)
            }
          } else {
            console.warn(
              '[HANDSHAKE-DEBUG] Skipping accept capsule enqueue — no record.p2p_endpoint AND no coordination_url configured. Initiator will NOT receive the accept; the handshake will stall.',
              handshake_id,
            )
          }
          // Enqueue context_sync AFTER the accept so the initiator always receives
          // the accept capsule first. The accept updates counterparty_public_key on the
          // initiator's record; if context_sync arrives first, the signature check fails.
          console.log('[ACCEPT-8] About to tryEnqueueContextSync')
          console.log('[HANDSHAKE-DEBUG] Calling tryEnqueueContextSync after accept', handshake_id)
          const contextResult = tryEnqueueContextSync(db, handshake_id, session, {
            lastCapsuleHash: capsule.capsule_hash,
          })
          console.log('[ACCEPT-9] Context sync result:', JSON.stringify(contextResult))
          console.log('[HANDSHAKE-DEBUG] tryEnqueueContextSync result:', handshake_id, contextResult)
          if (contextResult.success) {
            console.log('[ACCEPT-10] Processing outbound queue')
            console.log('[HANDSHAKE-DEBUG] processOutboundQueue starting (coordination path)', handshake_id)
            processOutboundQueue(db, _getOidcToken)
              .then(() => console.log('[HANDSHAKE-DEBUG] processOutboundQueue settled (coordination path)', handshake_id))
              .catch((e) => console.log('[HANDSHAKE-DEBUG] processOutboundQueue rejected (coordination path)', handshake_id, e))
            // Replay any context_sync that arrived before the accept was processed (acceptor path).
            // The initiator's context_sync may have been buffered because our record didn't have
            // counterparty_public_key yet. Now that we've accepted, replay it immediately.
            replayBufferedContextSync(handshake_id, db, session, _getOidcToken)
          } else if (contextResult.reason === 'VAULT_LOCKED') {
            // Already deferred — will be retried when vault is unlocked
            console.log('[HANDSHAKE-DEBUG] context_sync deferred — vault locked', handshake_id)
          } else if (contextResult.reason === 'INTERNAL_RELAY_ENDPOINTS_INCOMPLETE') {
            // context_sync_pending=1 (set in tryEnqueue) — P2P startup / completePending will retry
            console.log('[HANDSHAKE-DEBUG] context_sync deferred — internal relay endpoints incomplete', handshake_id)
          } else {
            console.warn('[P2P] context_sync enqueue skipped after accept:', contextResult.reason)
          }
        })
      } else {
        console.log('[ACCEPT-SKIP] Post-accept flow NOT scheduled. Reason:', {
          success: localResult?.success,
          hasAuth: !!(p2pAuthToken || getP2PConfig(db).use_coordination),
          hasEmail: !!initiatorEmail,
          handshake_id,
        })
        if (localResult.success && db) {
          console.log('[HANDSHAKE-DEBUG] Post-accept setImmediate NOT scheduled — check p2p token, coordination, initiatorEmail', {
            handshake_id,
            p2pAuthToken: !!p2pAuthToken,
            use_coordination: getP2PConfig(db).use_coordination,
            initiatorEmail: initiatorEmail || '(missing)',
          })
        }
      }

      // Auto-trigger P2P context-sync: enqueue when ACCEPTED, or defer if vault locked
      let contextSyncStatus: 'sent' | 'vault_locked' | 'skipped' = 'skipped'
      if (localResult.success && db) {
        // NOTE: for coordination mode, context_sync is enqueued inside the setImmediate above
        // (after the accept capsule) to guarantee ordering. Here we only handle non-coordination
        // mode (direct P2P) or when relay registration is not applicable.
        if (!getP2PConfig(db).use_coordination) {
          console.log('[HANDSHAKE-DEBUG] Non-coordination path: tryEnqueueContextSync from accept handler', handshake_id)
          const contextResult = tryEnqueueContextSync(db, handshake_id, session, {
            lastCapsuleHash: capsule.capsule_hash,
          })
          contextSyncStatus = contextResult.success ? 'sent' : (contextResult.reason === 'VAULT_LOCKED' ? 'vault_locked' : 'skipped')
          if (contextResult.success) {
            setImmediate(() => {
              console.log('[HANDSHAKE-DEBUG] processOutboundQueue (non-coordination) scheduled', handshake_id)
              processOutboundQueue(db, _getOidcToken)
                .then(() => console.log('[HANDSHAKE-DEBUG] processOutboundQueue settled (non-coordination)', handshake_id))
                .catch((e) => console.log('[HANDSHAKE-DEBUG] processOutboundQueue rejected (non-coordination)', handshake_id, e))
            })
          }
        } else {
          // Coordination: tryEnqueueContextSync runs inside setImmediate (after accept + relay
          // registration). Result is unknown here — do not report 'sent'. DB defers with
          // context_sync_pending when vault is locked or INTERNAL_RELAY_ENDPOINTS_INCOMPLETE.
          contextSyncStatus = 'skipped'
          console.log(
            '[HANDSHAKE-DEBUG] Coordination mode: context_sync is attempted asynchronously after accept; check context_sync_pending on the row for deferrals',
            handshake_id,
          )
        }
      }

      // When ensureKeyAgreementKeys generated the ML-KEM keypair as a fallback (extension did not
      // provide senderMlkem768PublicKeyB64, e.g. PQ service was unavailable at accept time),
      // the secret is stored in the Electron DB but was never given to the extension.
      // Return it here so the extension can persist it via storeLocalMlkemSecret(handshakeId, secret).
      // The extension MUST store this before any inbound qBEAP can be decrypted.
      const electronGeneratedMlkemSecret =
        acceptKeyAgreement.sender_mlkem768_secret_key_b64 ?? null

      return {
        type: 'handshake-accept-result',
        success: localResult.success,
        handshake_id,
        email_sent: emailResult?.success ?? false,
        email_error: emailResult?.error,
        local_result: localResult,
        context_sync_status: contextSyncStatus,
        // Non-null only when Electron generated the ML-KEM keypair (fallback path).
        // Null when extension provided its own ML-KEM public key (normal path — extension already has the secret).
        electronGeneratedMlkemSecret,
        message: contextSyncStatus === 'vault_locked'
          ? 'Handshake accepted. Unlock your vault to complete the secure exchange.'
          : contextSyncStatus === 'sent'
            ? 'Handshake accepted. Completing exchange...'
            : undefined,
      }
    }

    case 'handshake.refresh': {
      const { handshake_id, context_block_proofs, fromAccountId } = params as {
        handshake_id: string
        context_block_proofs?: ContextBlockProof[]
        fromAccountId: string
      }

      if (!handshake_id) {
        return { success: false, error: 'handshake_id is required' }
      }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      const record = getHandshakeRecord(db, handshake_id)
      if (!record) {
        return { success: false, error: 'Handshake not found', reason: ReasonCode.HANDSHAKE_NOT_FOUND }
      }
      const refreshActiveCheck = diagnoseHandshakeInactive(db, handshake_id, new Date())
      if (!refreshActiveCheck.active) {
        return { success: false, error: refreshActiveCheck.reason }
      }

      const counterpartyUserId = record.initiator.wrdesk_user_id === session.wrdesk_user_id
        ? record.acceptor!.wrdesk_user_id
        : record.initiator.wrdesk_user_id
      const counterpartyEmail = getCounterpartyEmail(record, session)

      const localPub = record.local_public_key ?? ''
      const localPriv = record.local_private_key ?? ''
      if (!localPub || !localPriv) {
        return { success: false, error: 'Handshake signing keys not found. Re-accept the handshake to enable signatures.' }
      }
      let refreshLocalDev: string | undefined
      try {
        refreshLocalDev = getLocalDeviceIdForRelay()
      } catch {
        refreshLocalDev = undefined
      }
      const refreshInternalWire = internalRelayCapsuleWireOptsFromRecord(record, refreshLocalDev)
      if (record.handshake_type === 'internal' && getP2PConfig(db).use_coordination && !refreshInternalWire) {
        return {
          success: false,
          error:
            'INTERNAL_RELAY_ENDPOINTS_INCOMPLETE: cannot refresh over coordination without both device ids on the handshake record',
        }
      }
      const capsule = buildRefreshCapsule(session, {
        handshake_id,
        counterpartyUserId,
        counterpartyEmail,
        last_seq_sent: record.last_seq_sent ?? 0,
        last_seq_received: record.last_seq_received,
        last_capsule_hash_received: record.last_capsule_hash_received,
        context_block_proofs: context_block_proofs ?? [],
        local_public_key: localPub,
        local_private_key: localPriv,
        ...(refreshInternalWire ?? {}),
      })

      let emailResult: any = null
      if (fromAccountId && counterpartyEmail) {
        emailResult = await sendCapsuleViaEmail(fromAccountId, counterpartyEmail, capsule)
      }

      const localResult = await submitCapsuleViaRpc(capsule, db, session)

      return {
        type: 'handshake-refresh-result',
        success: localResult.success,
        handshake_id,
        capsule_hash: capsule.capsule_hash,
        email_sent: emailResult?.success ?? false,
        email_error: emailResult?.error,
        local_result: localResult,
      }
    }

    // Phase 3: sender auto-delivers content after handshake confirmed
    case 'handshake.sendContextDelivery': {
      const { handshakeId } = params as { handshakeId: string }
      if (!handshakeId) return { success: false, error: 'handshakeId required' }
      if (!db) return { success: false, error: 'Vault locked' }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      const contextDeliveryActiveCheck = diagnoseHandshakeInactive(db, handshakeId, new Date())
      if (!contextDeliveryActiveCheck.active) {
        return { success: false, error: contextDeliveryActiveCheck.reason }
      }
      const record = getHandshakeRecord(db, handshakeId)
      if (!record) {
        return { success: false, error: 'Handshake not found' }
      }

      const pending = getContextStoreByHandshake(db, handshakeId, 'pending_delivery')
      if (pending.length === 0) {
        return { success: true, delivered: 0 }
      }

      const { computeContextCommitment: computeCommitment } = await import('./contextCommitment')
      const deliveryBlocks = pending.map(b => ({
        block_id: b.block_id,
        block_hash: b.block_hash,
        type: b.type,
        content: b.content ?? '',
        scope_id: b.scope_id ?? undefined,
      }))
      const contextCommitment = computeCommitment(deliveryBlocks)

      const deliveryCapsule = {
        schema_version: 2 as const,
        capsule_type: 'context_delivery' as const,
        handshake_id: handshakeId,
        relationship_id: record.relationship_id,
        sender_id: session.wrdesk_user_id,
        context_blocks: deliveryBlocks,
        context_commitment: contextCommitment,
        timestamp: new Date().toISOString(),
      }

      updateContextStoreStatusBulk(db, handshakeId, 'pending_delivery', 'delivered')

      return {
        success: true,
        delivered: pending.length,
        delivery_capsule: deliveryCapsule,
      }
    }

    // Phase 3: receiver ingests content from context_delivery capsule
    case 'handshake.receiveContextDelivery': {
      const { handshakeId, context_blocks: deliveredBlocks } = params as {
        handshakeId: string
        context_blocks: Array<{
          block_id: string
          block_hash: string
          type: string
          content: string
          scope_id?: string
        }>
      }

      if (!handshakeId || !Array.isArray(deliveredBlocks)) {
        return { success: false, error: 'handshakeId and context_blocks required' }
      }
      if (!db) return { success: false, error: 'Vault locked' }

      const receiveDeliveryActiveCheck = diagnoseHandshakeInactive(db, handshakeId, new Date())
      if (!receiveDeliveryActiveCheck.active) {
        return {
          success: false,
          error: `${receiveDeliveryActiveCheck.reason} — content delivery rejected`,
        }
      }
      const record = getHandshakeRecord(db, handshakeId)
      if (!record) {
        return { success: false, error: 'Handshake not found' }
      }

      const proofs = getContextStoreByHandshake(db, handshakeId, 'pending')
      const proofMap = new Map(proofs.map(p => [p.block_id, p.block_hash]))

      const { createHash } = await import('crypto')
      const ingested: string[] = []
      const rejected: Array<{ block_id: string; reason: string }> = []

      for (const block of deliveredBlocks) {
        // Verify block_id exists in handshake commitments
        const expectedHash = proofMap.get(block.block_id)
        if (!expectedHash) {
          rejected.push({ block_id: block.block_id, reason: 'block_id not in handshake commitments' })
          continue
        }

        // Verify SHA-256(content) matches block_hash from handshake
        const contentHash = createHash('sha256')
          .update(typeof block.content === 'string' ? block.content : JSON.stringify(block.content), 'utf8')
          .digest('hex')

        if (contentHash !== expectedHash) {
          rejected.push({ block_id: block.block_id, reason: 'content hash mismatch — tampered' })
          continue
        }

        if (contentHash !== block.block_hash) {
          rejected.push({ block_id: block.block_id, reason: 'declared block_hash mismatch' })
          continue
        }

        // Hash verified — ingest content
        updateContextStoreStatus(
          db, block.block_id, handshakeId, 'received',
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
        )
        ingested.push(block.block_id)
      }

      return {
        success: rejected.length === 0,
        ingested: ingested.length,
        rejected,
      }
    }

    case 'handshake.semanticSearch': {
      const { query, scope, limit } = params ?? {}
      if (!db) {
        return { success: false, error: 'vault_locked' }
      }
      const vs = (globalThis as any).__og_vault_service_ref as { getEmbeddingService?: () => any } | undefined
      const embeddingService = vs?.getEmbeddingService?.()
      const filter: { relationship_id?: string; handshake_id?: string } = {}
      if (typeof scope === 'string') {
        if (scope.startsWith('hs-')) filter.handshake_id = scope
        else if (scope.startsWith('rel-')) filter.relationship_id = scope
      }
      // Fallback scope: when no handshake selected, use most recent handshake with context
      if (!filter.handshake_id && !filter.relationship_id && (scope === 'context-graph' || scope === 'all')) {
        try {
          const row = db.prepare(
            `SELECT c.handshake_id FROM context_blocks c
             INNER JOIN handshakes h ON h.handshake_id = c.handshake_id
             WHERE h.state IN ('ACCEPTED','ACTIVE')
             ORDER BY h.created_at DESC LIMIT 1`
          ).get() as { handshake_id: string } | undefined
          if (row?.handshake_id) filter.handshake_id = row.handshake_id
        } catch { /* ignore */ }
      }
      // When embedding unavailable: run structured lookup, then keyword fallback
      if (!embeddingService) {
        try {
          const { queryClassifier, structuredLookup, structuredLookupMulti, fetchBlocksForStructuredLookup } = await import('./structuredQuery')
          const trimmed = (query ?? '').trim()
          const classifierResult = queryClassifier(trimmed)
          const pathForFetch = classifierResult.fieldPaths?.[0] ?? classifierResult.fieldPath
          if (classifierResult.matched && pathForFetch) {
            const blocks = fetchBlocksForStructuredLookup(db, filter, pathForFetch)
            if (blocks.length > 0) {
              const structResult = classifierResult.fieldPaths && classifierResult.fieldPaths.length > 0
                ? structuredLookupMulti(blocks, classifierResult.fieldPaths)
                : structuredLookup(blocks, classifierResult.fieldPath!)
              if (structResult.found && structResult.value && structResult.source) {
                const matched_field_label = pathToHumanLabel(pathForFetch)
                const enriched = [{
                  block_id: structResult.source.block_id,
                  handshake_id: structResult.source.handshake_id,
                  source: structResult.source.source ?? 'sent',
                  snippet: structResult.value,
                  payload_ref: structResult.value,
                  score: 1,
                  type: 'profile',
                  matched_field_label,
                  structured_result: true,
                  governance_summary: 'No restrictions' as string,
                }]
                return { success: true, results: enriched, degraded: 'structured_only' }
              }
            }
          }
          // Keyword/text fallback when no structured match
          const { keywordSearch } = await import('./keywordSearch')
          const keywordResults = keywordSearch(db, trimmed, filter, limit ?? 20)
          const { parseGovernanceJson, resolveEffectiveGovernance } = await import('./contextGovernance')
          const enriched = keywordResults.map((r) => {
            const row = db.prepare('SELECT governance_json FROM context_blocks WHERE handshake_id=? AND block_id=? AND block_hash=?').get(r.handshake_id, r.block_id, r.block_hash) as { governance_json?: string } | undefined
            const record = getHandshakeRecord(db, r.handshake_id)
            let governance: ContextItemGovernance | null = null
            if (record) {
              const itemGov = parseGovernanceJson(row?.governance_json)
              const legacy = {
                block_id: r.block_id,
                type: r.type,
                data_classification: r.data_classification,
                scope_id: r.scope_id,
                sender_wrdesk_user_id: r.sender_wrdesk_user_id,
                publisher_id: r.sender_wrdesk_user_id,
                source: r.source,
              }
              governance = resolveEffectiveGovernance(itemGov, legacy, record, record.relationship_id)
            }
            const policy = governance?.usage_policy
            let governance_summary: string
            if (!policy) {
              governance_summary = 'No restrictions'
            } else if (policy.local_ai_allowed === false) {
              governance_summary = 'No AI'
            } else if (policy.cloud_ai_allowed === true) {
              governance_summary = 'Cloud AI allowed'
            } else if (policy.local_ai_allowed === true) {
              governance_summary = 'Local AI only'
            } else {
              governance_summary = 'No restrictions'
            }
            const snippet = extractSnippetFromPayload(r.payload_ref ?? '')
            return { ...r, governance_summary, snippet: snippet || r.payload_ref }
          })
          return { success: true, results: enriched, degraded: 'keyword_fallback' }
        } catch (err: any) {
          console.error('[IPC] semanticSearch degraded fallback error:', err?.message)
          return { success: false, error: 'embedding_unavailable' }
        }
      }
      try {
        const results = await semanticSearch(db, query ?? '', filter, limit ?? 20, embeddingService)
        const { parseGovernanceJson, resolveEffectiveGovernance } = await import('./contextGovernance')
        const enriched = results.map((r) => {
          const row = db.prepare('SELECT governance_json FROM context_blocks WHERE handshake_id=? AND block_id=? AND block_hash=?').get(r.handshake_id, r.block_id, r.block_hash) as { governance_json?: string } | undefined
          const record = getHandshakeRecord(db, r.handshake_id)
          let governance: ContextItemGovernance | null = null
          if (record) {
            const itemGov = parseGovernanceJson(row?.governance_json)
            const legacy = {
              block_id: r.block_id,
              type: r.type,
              data_classification: r.data_classification,
              scope_id: r.scope_id,
              sender_wrdesk_user_id: r.sender_wrdesk_user_id,
              publisher_id: r.sender_wrdesk_user_id,
              source: r.source,
            }
            governance = resolveEffectiveGovernance(itemGov, legacy, record, record.relationship_id)
          }
          const policy = governance?.usage_policy
          let governance_summary: string
          if (!policy) {
            governance_summary = 'No restrictions'
          } else if (policy.local_ai_allowed === false) {
            governance_summary = 'No AI'
          } else if (policy.cloud_ai_allowed === true) {
            governance_summary = 'Cloud AI allowed'
          } else if (policy.local_ai_allowed === true) {
            governance_summary = 'Local AI only'
          } else {
            governance_summary = 'No restrictions'
          }
          return { ...r, governance_summary }
        })
        return { success: true, results: enriched }
      } catch (err: any) {
        console.error('[IPC] semanticSearch error:', err?.message)
        return { success: false, error: err?.message ?? 'search_failed' }
      }
    }

    case 'beap.getDevicePublicKey': {
      try {
        const publicKey = await getDeviceX25519PublicKey()
        return { success: true, publicKey }
      } catch (e) {
        if (e instanceof DeviceKeyNotFoundError) {
          return { success: false, error: e.message, code: e.code }
        }
        console.error('[IPC] beap.getDevicePublicKey failed:', e)
        return { success: false, error: String(e) }
      }
    }

    case 'beap.getMlkemSecret': {
      // Returns the ML-KEM-768 secret key for a handshake from the Electron DB.
      // Used by importPipeline.ts (extension sandbox decrypt path) to perform hybrid
      // decapsulation. The secret never enters chrome.storage — it lives only in the
      // encrypted orchestrator DB (local_mlkem768_secret_key_b64).
      const hsId = typeof params.handshakeId === 'string' ? params.handshakeId.trim() : ''
      if (!hsId) return { success: false, error: 'handshakeId is required' }
      if (!db) return { success: false, error: 'Database unavailable' }
      try {
        const rec = getHandshakeRecord(db, hsId)
        const secret = rec?.local_mlkem768_secret_key_b64?.trim() ?? null
        if (!secret) {
          return { success: false, error: `No ML-KEM secret found for handshake: ${hsId}` }
        }
        return { success: true, mlkemSecretB64: secret }
      } catch (e) {
        console.error('[IPC] beap.getMlkemSecret failed:', e)
        return { success: false, error: String(e) }
      }
    }

    case 'beap.deriveSharedSecret': {
      const peerPublicKeyB64 = typeof params.peerPublicKeyB64 === 'string' ? params.peerPublicKeyB64.trim() : ''
      const handshakeId = typeof params.handshakeId === 'string' ? params.handshakeId.trim() : '(unknown)'
      if (!peerPublicKeyB64) {
        return { success: false, error: 'peerPublicKeyB64 is required' }
      }
      try {
        // For old handshakes (created before the device-key migration), the ephemeral private key
        // is stored in local_x25519_private_key_b64 on the handshake record. Use it when present
        // so that ECDH produces a shared secret consistent with what the receiver expects.
        // For new handshakes (local_x25519_private_key_b64 = NULL), fall through to the device key.
        let privateKeyB64: string | null = null
        if (db && handshakeId && handshakeId !== '(unknown)') {
          try {
            const hsRecord = getHandshakeRecord(db, handshakeId)
            if (hsRecord?.local_x25519_private_key_b64?.trim()) {
              privateKeyB64 = hsRecord.local_x25519_private_key_b64.trim()
              console.log(`[IPC] beap.deriveSharedSecret: using handshake-stored private key for ${handshakeId}`)
            }
          } catch {
            // DB lookup failed — fall through to device key
          }
        }
        if (!privateKeyB64) {
          const { privateKey } = await getDeviceX25519KeyPair()
          privateKeyB64 = privateKey
          console.log(`[IPC] beap.deriveSharedSecret: using device private key for ${handshakeId}`)
        }
        const privateKeyBytes = Buffer.from(privateKeyB64, 'base64')
        const peerPublicKeyBytes = Buffer.from(peerPublicKeyB64, 'base64')
        if (privateKeyBytes.length !== 32) {
          return { success: false, error: `Invalid private key length: ${privateKeyBytes.length}` }
        }
        if (peerPublicKeyBytes.length !== 32) {
          return { success: false, error: `Invalid peer public key length: ${peerPublicKeyBytes.length}` }
        }
        const sharedSecret = x25519.getSharedSecret(privateKeyBytes, peerPublicKeyBytes)
        console.log(`[IPC] beap.deriveSharedSecret: ECDH completed for handshake ${handshakeId}`)
        return {
          success: true,
          sharedSecretB64: Buffer.from(sharedSecret).toString('base64'),
        }
      } catch (e) {
        if (e instanceof DeviceKeyNotFoundError) {
          return { success: false, error: e.message, code: e.code }
        }
        console.error('[IPC] beap.deriveSharedSecret failed:', e)
        return { success: false, error: String(e) }
      }
    }

    default:
      return { error: 'unknown_method', reason: ReasonCode.INTERNAL_ERROR }
  }
}
export function registerHandshakeRoutes(app: any, getDb: () => any): void {
  app.get('/api/handshake/status/:id', (req: any, res: any) => {
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'vault_locked' })
      const record = getHandshakeRecord(db, req.params.id)
      res.json({ record: record ?? null, reason: record ? 'OK' : 'HANDSHAKE_NOT_FOUND' })
    } catch (err: any) {
      res.status(500).json({ error: err?.message })
    }
  })

  app.get('/api/handshake/list', (req: any, res: any) => {
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'vault_locked' })
      const state = req.query.state as HandshakeState | undefined
      const relationship_id = req.query.relationship_id as string | undefined
      const records = listHandshakeRecords(db, { state, relationship_id })
      res.json({ records })
    } catch (err: any) {
      res.status(500).json({ error: err?.message })
    }
  })

  app.get('/api/handshake/:id/context-blocks', (req: any, res: any) => {
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'vault_locked' })
      const purpose = req.query.purpose as string | undefined
      let blocks = queryContextBlocksWithGovernance(db, req.params.id)
      const record = getHandshakeRecord(db, req.params.id)
      const baseline = record ? baselineFromHandshake(record) : null
      if (purpose === 'local_ai') blocks = filterBlocksForLocalAI(blocks, baseline)
      else if (purpose === 'cloud_ai') blocks = filterBlocksForCloudAI(blocks, baseline)
      else if (purpose === 'export') blocks = filterBlocksForExport(blocks, baseline)
      else if (purpose === 'search') blocks = filterBlocksForSearch(blocks, baseline)
      else if (purpose === 'peer_transmission') blocks = filterBlocksForPeerTransmission(blocks, baseline)
      else if (purpose === 'auto_reply') blocks = filterBlocksForAutoReply(blocks, baseline)
      res.json({ blocks })
    } catch (err: any) {
      res.status(500).json({ error: err?.message })
    }
  })

  app.post('/api/handshake/:id/revoke', async (req: any, res: any) => {
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'vault_locked' })
      const session = _getSession()
      await revokeHandshake(db, req.params.id, 'local-user', session?.wrdesk_user_id, session ?? undefined, _getOidcToken)
      res.json({ success: true })
    } catch (err: any) {
      res.status(500).json({ error: err?.message })
    }
  })
}
