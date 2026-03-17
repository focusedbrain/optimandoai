/**
 * Handshake IPC handlers for WebSocket RPC and HTTP routes.
 *
 * WebSocket RPC methods: handshake.*
 * HTTP routes: /api/handshake/*
 */

import type { HandshakeState, SSOSession, HandshakeRecord } from './types'
import type { ContextBlockProof } from './canonicalRebuild'
import { ReasonCode, HandshakeState as HS } from './types'
// Context resolution imports removed — content enters only via the BEAP-Capsule pipeline
import {
  getHandshakeRecord,
  listHandshakeRecords,
  deleteHandshakeRecord,
  updateHandshakeSigningKeys,
  getPendingP2PBeapMessages,
  markP2PPendingBeapProcessed,
  getPendingPlainEmails,
  markPlainEmailProcessed,
} from './db'
import { queryContextBlocks, queryContextBlocksWithGovernance } from './contextBlocks'
import { authorizeAction, isHandshakeActive } from './enforcement'
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
import { tryEnqueueContextSync } from './contextSyncEnqueue'
import { deriveRelationshipId } from './relationshipId'
import { enqueueOutboundCapsule, processOutboundQueue } from './outboundQueue'
import { randomBytes, randomUUID, generateKeyPairSync } from 'crypto'
import { getP2PConfig, getEffectiveRelayEndpoint } from '../p2p/p2pConfig'
import { registerHandshakeWithRelay } from '../p2p/relaySync'
import { processIncomingInput } from '../ingestion/ingestionPipeline'
import { replayBufferedContextSync } from '../p2p/coordinationWs'
import { canonicalRebuild } from './canonicalRebuild'
import { semanticSearch } from './embeddings'
import { validateReceiverEmail } from '../../../../../packages/shared/src/handshake/receiverEmailValidation'
import { vaultService } from '../vault/rpc'

// ── Key Agreement Helpers (fallback when extension does not provide keys) ──

async function ensureKeyAgreementKeys(params: {
  sender_x25519_public_key_b64?: string | null
  sender_mlkem768_public_key_b64?: string | null
}): Promise<{ sender_x25519_public_key_b64: string; sender_mlkem768_public_key_b64: string }> {
  let x25519 = params.sender_x25519_public_key_b64?.trim()
  let mlkem = params.sender_mlkem768_public_key_b64?.trim()
  if (!x25519 || x25519.length < 32) {
    const { publicKey } = generateKeyPairSync('x25519')
    const raw = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
    x25519 = raw.subarray(-32).toString('base64')
  }
  if (!mlkem || mlkem.length < 100) {
    const pq = await import('@noble/post-quantum/ml-kem')
    const keypair = pq.ml_kem768.keygen()
    mlkem = Buffer.from(keypair.publicKey).toString('base64')
  }
  return { sender_x25519_public_key_b64: x25519, sender_mlkem768_public_key_b64: mlkem }
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
      return {
        success: true,
        handshake_id: persistResult.handshake_id,
        state: HS.PENDING_REVIEW,
        sender: (cap?.senderIdentity ?? cap?.sender_email) as { email?: string } | string,
      }
    }

    case 'handshake.list': {
      const filter = params?.filter as { state?: HandshakeState; relationship_id?: string } | undefined
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
      const { handshakeId, packageJson } = params as { handshakeId: string; packageJson: string }
      if (!handshakeId || !packageJson) {
        return { success: false, error: 'handshakeId and packageJson are required' }
      }
      if (!db) return { success: false, error: 'Database unavailable' }
      const record = getHandshakeRecord(db, handshakeId)
      if (!record) return { success: false, error: 'Handshake not found' }
      if (!isHandshakeActive(db, handshakeId, new Date())) {
        return { success: false, error: 'Handshake is not active' }
      }
      const targetEndpoint = record.p2p_endpoint?.trim()
      if (!targetEndpoint) {
        return { success: false, error: 'Recipient has no P2P endpoint' }
      }
      let pkg: object
      try {
        pkg = JSON.parse(packageJson) as object
      } catch (err: any) {
        return { success: false, error: `Invalid package: ${err?.message ?? 'decode failed'}` }
      }
      enqueueOutboundCapsule(db, handshakeId, targetEndpoint, pkg)
      await processOutboundQueue(db, _getOidcToken)
      return { success: true }
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
      }

      if (!receiverUserId || !receiverEmail) {
        return { success: false, error: 'receiverUserId and receiverEmail are required' }
      }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      const handshakeId = `hs-${randomUUID()}`
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

      const keyAgreement = await ensureKeyAgreementKeys({
        sender_x25519_public_key_b64: (params as any).senderX25519PublicKeyB64 ?? (params as any).key_agreement?.x25519_public_key_b64,
        sender_mlkem768_public_key_b64: (params as any).senderMlkem768PublicKeyB64 ?? (params as any).key_agreement?.mlkem768_public_key_b64,
      })

      const { capsule, localBlocks, keypair } = buildInitiateCapsuleWithContent(session, {
        receiverUserId,
        receiverEmail,
        handshake_id: handshakeId,
        ...(allBlocks.length > 0 ? { context_blocks: allBlocks } : {}),
        ...(p2pEndpoint ? { p2p_endpoint: p2pEndpoint } : {}),
        ...(p2pAuthToken ? { p2p_auth_token: p2pAuthToken } : {}),
        sender_x25519_public_key_b64: keyAgreement.sender_x25519_public_key_b64,
        sender_mlkem768_public_key_b64: keyAgreement.sender_mlkem768_public_key_b64,
      })

      const canonicalBlockPolicyMap = new Map<string, { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }>()
      for (let i = 0; i < allBlocks.length && i < localBlocks.length; i++) {
        const policy = initBlockPolicyMap.get(allBlocks[i].block_id)
        if (policy) canonicalBlockPolicyMap.set(localBlocks[i].block_id, policy)
      }

      const effectiveAccountId = fromAccountId || session.email || ''

      let emailResult: any = null
      if (effectiveAccountId) {
        emailResult = await sendCapsuleViaEmail(effectiveAccountId, receiverEmail, capsule)
      }

      let localResult: any = { success: true }
      if (db) {
        // Initiator persists own record via direct insert — NOT the receive pipeline.
        // The pipeline rejects when senderId === localUserId (ownership check).
        localResult = persistInitiatorHandshakeRecord(db, capsule, session, localBlocks, keypair, initPolicySelections, canonicalBlockPolicyMap)
        if (localResult.success && (p2pAuthToken || getP2PConfig(db).use_coordination) && receiverEmail) {
          setImmediate(async () => {
            const p2pConfig = getP2PConfig(db)
            const result = p2pConfig.use_coordination
              ? await registerHandshakeWithRelay(db, capsule.handshake_id, p2pAuthToken ?? '', receiverEmail, _getOidcToken, {
                  initiator_user_id: session.wrdesk_user_id,
                  acceptor_user_id: receiverUserId,
                  initiator_email: session.email,
                  acceptor_email: receiverEmail,
                })
              : await registerHandshakeWithRelay(db, capsule.handshake_id, p2pAuthToken ?? '', receiverEmail)
            if (!result.success) console.warn('[Relay] Register handshake failed:', result.error)
            // Initiate capsule is NOT sent via relay — only file/email/USB. Relay used after accept.
          })
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
      }

      if (!dlReceiverUserId || !dlReceiverEmail) {
        return { success: false, error: 'receiverUserId and receiverEmail are required' }
      }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      const dlHandshakeId = `hs-${randomUUID()}`
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

      const dlKeyAgreement = await ensureKeyAgreementKeys({
        sender_x25519_public_key_b64: (params as any).senderX25519PublicKeyB64 ?? (params as any).key_agreement?.x25519_public_key_b64,
        sender_mlkem768_public_key_b64: (params as any).senderMlkem768PublicKeyB64 ?? (params as any).key_agreement?.mlkem768_public_key_b64,
      })

      const { capsule, localBlocks, keypair } = buildInitiateCapsuleWithContent(session, {
        receiverUserId: dlReceiverUserId,
        receiverEmail: dlReceiverEmail,
        handshake_id: dlHandshakeId,
        ...(dlAllBlocks.length > 0 ? { context_blocks: dlAllBlocks } : {}),
        ...(dlP2PEndpoint ? { p2p_endpoint: dlP2PEndpoint } : {}),
        ...(dlP2PAuthToken ? { p2p_auth_token: dlP2PAuthToken } : {}),
        sender_x25519_public_key_b64: dlKeyAgreement.sender_x25519_public_key_b64,
        sender_mlkem768_public_key_b64: dlKeyAgreement.sender_mlkem768_public_key_b64,
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

      const buildLocalResult = persistInitiatorHandshakeRecord(db, capsule, session, localBlocks, keypair, dlPolicySelections, dlCanonicalBlockPolicyMap)
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
        const registerPromise = p2pConfig.use_coordination
          ? registerHandshakeWithRelay(db, capsule.handshake_id, dlP2PAuthToken ?? '', dlReceiverEmail, _getOidcToken, {
              initiator_user_id: session.wrdesk_user_id,
              acceptor_user_id: dlReceiverUserId,
              initiator_email: session.email,
              acceptor_email: dlReceiverEmail,
            })
          : registerHandshakeWithRelay(db, capsule.handshake_id, dlP2PAuthToken ?? '', dlReceiverEmail)

        await registerPromise.then((result) => {
          if (!result.success) console.warn('[Relay] Register handshake failed:', result.error)
          // Initiate capsule is NOT sent via relay — only file/email/USB. Relay used after accept.
        }).catch((err: any) => {
          console.warn('[Relay] Register handshake error (non-fatal):', err?.message)
        })
      }

      return {
        type: 'handshake-build-result',
        success: true,
        handshake_id: capsule.handshake_id,
        capsule_json: JSON.stringify(capsule),
        suggested_filename: `handshake_${localpart}_${shortHash}.beap`,
      }
    }

    case 'handshake.accept': {
      const { handshake_id, sharing_mode: requested_sharing_mode, fromAccountId, context_blocks: receiverRawBlocks, profile_ids: receiverProfileIds, profile_items: receiverProfileItems, p2p_endpoint: p2pEndpointParam, policy_selections: acceptPolicySelections } = params as {
        handshake_id: string
        sharing_mode: 'receive-only' | 'reciprocal'
        fromAccountId: string
        context_blocks?: RawBlockWithPolicy[]
        profile_ids?: string[]
        profile_items?: Array<{ profile_id: string; policy_mode?: 'inherit' | 'override'; policy?: { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean } }>
        p2p_endpoint?: string | null
        policy_selections?: { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }
      }

      if (!handshake_id || !requested_sharing_mode) {
        return { success: false, error: 'handshake_id and sharing_mode are required' }
      }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      const record = getHandshakeRecord(db, handshake_id)
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

      const initiatorUserId = record.initiator.wrdesk_user_id
      const initiatorEmail = record.initiator.email

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

      const acceptKeyAgreement = await ensureKeyAgreementKeys({
        sender_x25519_public_key_b64: (params as any).senderX25519PublicKeyB64 ?? (params as any).key_agreement?.x25519_public_key_b64,
        sender_mlkem768_public_key_b64: (params as any).senderMlkem768PublicKeyB64 ?? (params as any).key_agreement?.mlkem768_public_key_b64,
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
      })
      updateHandshakeSigningKeys(db, handshake_id, {
        local_public_key: keypair.publicKey,
        local_private_key: keypair.privateKey,
      })

      // 4. Store initiator block stubs (content NULL, status pending) + receiver blocks (content + pending_delivery)
      const hasAcceptPolicy = acceptPolicySelections && (
        (acceptPolicySelections as { ai_processing_mode?: string }).ai_processing_mode !== undefined ||
        (acceptPolicySelections as { cloud_ai?: boolean }).cloud_ai !== undefined ||
        (acceptPolicySelections as { internal_ai?: boolean }).internal_ai !== undefined
      )
      if (hasAcceptPolicy) {
        updateHandshakePolicySelections(db, handshake_id, acceptPolicySelections!)
      }
      const relationshipId = deriveRelationshipId(initiatorUserId, session.wrdesk_user_id)
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

      if (localResult.success && (p2pAuthToken || getP2PConfig(db).use_coordination) && initiatorEmail) {
        setImmediate(async () => {
          const p2pConfig = getP2PConfig(db)
          const result = p2pConfig.use_coordination
            ? await registerHandshakeWithRelay(db, handshake_id, p2pAuthToken ?? '', initiatorEmail, _getOidcToken, {
                initiator_user_id: initiatorUserId,
                acceptor_user_id: session.wrdesk_user_id,
                initiator_email: initiatorEmail,
                acceptor_email: session.email,
              })
            : await registerHandshakeWithRelay(db, handshake_id, p2pAuthToken ?? '', initiatorEmail)
          if (!result.success) {
            console.warn('[Relay] Register handshake failed:', result.error)
            return
          }
          // Enqueue accept capsule for relay delivery to initiator
          const targetEndpoint = record.p2p_endpoint?.trim()
          if (targetEndpoint) {
            try {
              enqueueOutboundCapsule(db, handshake_id, targetEndpoint, capsule)
            } catch (err: any) {
              console.warn('[P2P] Enqueue accept capsule failed:', err?.message)
            }
          }
          // Enqueue context_sync AFTER the accept so the initiator always receives
          // the accept capsule first. The accept updates counterparty_public_key on the
          // initiator's record; if context_sync arrives first, the signature check fails.
          const contextResult = tryEnqueueContextSync(db, handshake_id, session, {
            lastCapsuleHash: capsule.capsule_hash,
          })
          if (contextResult.success) {
            processOutboundQueue(db, _getOidcToken).catch(() => {})
            // Replay any context_sync that arrived before the accept was processed (acceptor path).
            // The initiator's context_sync may have been buffered because our record didn't have
            // counterparty_public_key yet. Now that we've accepted, replay it immediately.
            replayBufferedContextSync(handshake_id, db, session, _getOidcToken)
          } else if (contextResult.reason === 'VAULT_LOCKED') {
            // Already deferred — will be retried when vault is unlocked
          } else {
            console.warn('[P2P] context_sync enqueue skipped after accept:', contextResult.reason)
          }
        })
      }

      // Auto-trigger P2P context-sync: enqueue when ACCEPTED, or defer if vault locked
      let contextSyncStatus: 'sent' | 'vault_locked' | 'skipped' = 'skipped'
      if (localResult.success && db) {
        // NOTE: for coordination mode, context_sync is enqueued inside the setImmediate above
        // (after the accept capsule) to guarantee ordering. Here we only handle non-coordination
        // mode (direct P2P) or when relay registration is not applicable.
        if (!getP2PConfig(db).use_coordination) {
          const contextResult = tryEnqueueContextSync(db, handshake_id, session, {
            lastCapsuleHash: capsule.capsule_hash,
          })
          contextSyncStatus = contextResult.success ? 'sent' : (contextResult.reason === 'VAULT_LOCKED' ? 'vault_locked' : 'skipped')
          if (contextResult.success) {
            setImmediate(() => { processOutboundQueue(db, _getOidcToken).catch(() => {}) })
          }
        } else {
          // Coordination: context_sync handled inside setImmediate above, report optimistically
          contextSyncStatus = 'sent'
        }
      }

      return {
        type: 'handshake-accept-result',
        success: localResult.success,
        handshake_id,
        email_sent: emailResult?.success ?? false,
        email_error: emailResult?.error,
        local_result: localResult,
        context_sync_status: contextSyncStatus,
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
      if (record.state !== HS.ACTIVE) {
        return { success: false, error: `Handshake is in state ${record.state}, expected ACTIVE` }
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
      const capsule = buildRefreshCapsule(session, {
        handshake_id,
        counterpartyUserId,
        counterpartyEmail,
        last_seq_received: record.last_seq_received,
        last_capsule_hash_received: record.last_capsule_hash_received,
        context_block_proofs: context_block_proofs ?? [],
        local_public_key: localPub,
        local_private_key: localPriv,
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

      const record = getHandshakeRecord(db, handshakeId)
      if (!record || record.state !== HS.ACTIVE) {
        return { success: false, error: 'Handshake not active' }
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

      const record = getHandshakeRecord(db, handshakeId)
      if (!record || record.state !== HS.ACTIVE) {
        return { success: false, error: 'Handshake not active — content delivery rejected' }
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

    default:
      return { error: 'unknown_method', reason: ReasonCode.INTERNAL_ERROR }
  }
}

/**
 * Register handshake HTTP routes on an Express app.
 */
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
