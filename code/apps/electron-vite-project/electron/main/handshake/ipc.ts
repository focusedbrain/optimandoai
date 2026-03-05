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
} from './db'
import { queryContextBlocks } from './contextBlocks'
import { authorizeAction, isHandshakeActive } from './enforcement'
import { revokeHandshake } from './revocation'
import {
  buildInitiateCapsule,
  buildInitiateCapsuleWithContent,
  buildAcceptCapsule,
  buildRefreshCapsule,
} from './capsuleBuilder'
import { submitCapsuleViaRpc } from './capsuleTransport'
import { sendCapsuleViaEmail } from './emailTransport'
import { computeBlockHash, type ContextBlockForCommitment } from './contextCommitment'
import {
  insertContextStoreEntry,
  getContextStoreByHandshake,
  updateContextStoreStatus,
  updateContextStoreStatusBulk,
} from './db'
import { deriveRelationshipId } from './relationshipId'

// ── Context Block Helpers ──

const MAX_MESSAGE_BYTES = 32 * 1024
const MAX_BLOCKS_PER_CAPSULE = 64

/**
 * Convert raw RPC params (pre-built context_blocks and/or a plain message string)
 * into a fully formed ContextBlockForCommitment array ready for the capsule builder.
 *
 * block_ids assigned here are provisional — the capsule builder will
 * reassign canonical IDs scoped to the handshake_id.
 */
function buildContextBlocksFromParams(
  rawBlocks: ContextBlockForCommitment[] | undefined,
  rawMessage: string | undefined,
): ContextBlockForCommitment[] {
  const blocks: ContextBlockForCommitment[] = []

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

  return blocks
}

/**
 * Resolve HS Context Profile IDs to ContextBlockForCommitment[].
 * Requires vault service and Publisher+ tier. Used when acceptor attaches
 * Vault Profiles during handshake accept.
 */
function resolveProfileIdsToContextBlocks(
  profileIds: string[],
  session: SSOSession,
  handshakeId: string,
): ContextBlockForCommitment[] {
  if (!profileIds?.length) return []
  const vs = (globalThis as any).__og_vault_service_ref as { resolveHsProfilesForHandshake?: (tier: string, ids: string[]) => any[] } | undefined
  if (!vs?.resolveHsProfilesForHandshake) return []
  const tier = (session.plan === 'enterprise' || session.plan === 'publisher' || session.plan === 'publisher_lifetime')
    ? (session.plan as 'enterprise' | 'publisher' | 'publisher_lifetime')
    : 'free'
  if (tier === 'free') return []
  try {
    const resolved = vs.resolveHsProfilesForHandshake(tier, profileIds)
    const blocks: ContextBlockForCommitment[] = []
    const shortId = handshakeId.replace(/^hs-/, '').slice(0, 8)
    for (let i = 0; i < resolved.length && blocks.length < MAX_BLOCKS_PER_CAPSULE; i++) {
      const { profile, documents } = resolved[i]
      const content = JSON.stringify({
        profile: { id: profile.id, name: profile.name, fields: profile.fields, custom_fields: profile.custom_fields },
        documents: documents.map((d: any) => ({ filename: d.filename, extracted_text: d.extracted_text })),
      })
      const blockHash = computeBlockHash(content)
      blocks.push({
        block_id: `ctx-${shortId}-acceptor-${String(i + 1).padStart(3, '0')}`,
        block_hash: blockHash,
        type: 'vault_profile',
        content,
        scope_id: 'acceptor',
      })
    }
    return blocks
  } catch {
    return []
  }
}

// ── SSO Session Provider ──

export type SSOSessionProvider = () => SSOSession | undefined

let _getSession: SSOSessionProvider = () => undefined

/**
 * Inject the SSO session provider. Called once at app startup.
 * The provider returns the currently authenticated SSOSession,
 * or undefined if no session is active.
 */
export function setSSOSessionProvider(provider: SSOSessionProvider): void {
  _getSession = provider
}

/** @internal */
export function _resetSSOSessionProvider(): void {
  _getSession = () => undefined
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

    case 'handshake.requestContextBlocks': {
      const { handshakeId, scopes } = params
      const auth = authorizeAction(db, handshakeId, 'read-context', scopes ?? [], new Date())
      if (!auth.allowed) {
        return { type: 'context-blocks', blocks: [], reason: auth.reason }
      }
      const blocks = queryContextBlocks(db, { handshake_id: handshakeId })
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
        await revokeHandshake(db, handshakeId, 'local-user')
        return { type: 'revocation-result', success: true, reason: ReasonCode.OK }
      } catch {
        return { type: 'revocation-result', success: false, reason: ReasonCode.INTERNAL_ERROR }
      }
    }

    case 'handshake.list': {
      const filter = params?.filter as { state?: HandshakeState; relationship_id?: string } | undefined
      const records = listHandshakeRecords(db, filter)
      return { type: 'handshake-list', records }
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
      } = params as {
        receiverUserId: string
        receiverEmail: string
        fromAccountId: string
        skipVaultContext?: boolean
        context_blocks?: ContextBlockForCommitment[]
        message?: string
      }

      if (!receiverUserId || !receiverEmail) {
        return { success: false, error: 'receiverUserId and receiverEmail are required' }
      }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      const contextBlocks = buildContextBlocksFromParams(rawBlocks, rawMessage)

      const { capsule, localBlocks } = buildInitiateCapsuleWithContent(session, {
        receiverUserId,
        receiverEmail,
        ...(contextBlocks.length > 0 ? { context_blocks: contextBlocks } : {}),
      })

      const effectiveAccountId = fromAccountId || session.email || ''

      let emailResult: any = null
      if (effectiveAccountId) {
        emailResult = await sendCapsuleViaEmail(effectiveAccountId, receiverEmail, capsule)
      }

      let localResult: any = { success: true }
      if (db) {
        localResult = await submitCapsuleViaRpc(capsule, db, session)
      } else if (!skipVaultContext) {
        return { success: false, error: 'Vault must be unlocked for contextual handshakes' }
      }

      // Phase 1: store content locally as pending_delivery (sender side).
      // Must run AFTER submitCapsuleViaRpc so the handshakes row exists before
      // context_store's REFERENCES handshakes(handshake_id) FK is satisfied.
      if (db && localBlocks.length > 0 && localResult.success) {
        const relationshipId = deriveRelationshipId(session.wrdesk_user_id, receiverUserId)
        for (const block of localBlocks) {
          try {
            insertContextStoreEntry(db, {
              block_id: block.block_id,
              block_hash: block.block_hash,
              handshake_id: capsule.handshake_id,
              relationship_id: relationshipId,
              scope_id: block.scope_id ?? null,
              publisher_id: session.wrdesk_user_id,
              type: block.type,
              content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              status: 'pending_delivery',
              valid_until: null,
              ingested_at: null,
              superseded: 0,
            })
          } catch { /* non-fatal — context delivery can be retried */ }
        }
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
      } = params as {
        receiverUserId: string
        receiverEmail: string
        skipVaultContext?: boolean
        context_blocks?: ContextBlockForCommitment[]
        message?: string
      }

      if (!dlReceiverUserId || !dlReceiverEmail) {
        return { success: false, error: 'receiverUserId and receiverEmail are required' }
      }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      const dlContextBlocks = buildContextBlocksFromParams(dlRawBlocks, dlRawMessage)

      const { capsule, localBlocks } = buildInitiateCapsuleWithContent(session, {
        receiverUserId: dlReceiverUserId,
        receiverEmail: dlReceiverEmail,
        ...(dlContextBlocks.length > 0 ? { context_blocks: dlContextBlocks } : {}),
      })

      const localpart = dlReceiverEmail.split('@')[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'unknown'
      const shortHash = capsule.capsule_hash.slice(0, 8)

      // Persist the initiator capsule locally so the handshakes row exists before
      // context_store's FK constraint is checked.
      let buildLocalResult: any = { success: true }
      if (db) {
        buildLocalResult = await submitCapsuleViaRpc(capsule, db, session)
      }

      // Phase 1: store content locally as pending_delivery (sender side).
      // Must run AFTER submitCapsuleViaRpc so the handshakes FK parent row exists.
      if (db && localBlocks.length > 0 && buildLocalResult.success) {
        const relationshipId = deriveRelationshipId(session.wrdesk_user_id, dlReceiverUserId)
        for (const block of localBlocks) {
          try {
            insertContextStoreEntry(db, {
              block_id: block.block_id,
              block_hash: block.block_hash,
              handshake_id: capsule.handshake_id,
              relationship_id: relationshipId,
              scope_id: block.scope_id ?? null,
              publisher_id: session.wrdesk_user_id,
              type: block.type,
              content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              status: 'pending_delivery',
              valid_until: null,
              ingested_at: null,
              superseded: 0,
            })
          } catch { /* non-fatal — content delivery can be retried */ }
        }
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
      const { handshake_id, sharing_mode: requested_sharing_mode, fromAccountId, context_blocks: receiverRawBlocks, profile_ids: receiverProfileIds } = params as {
        handshake_id: string
        sharing_mode: 'receive-only' | 'reciprocal'
        fromAccountId: string
        context_blocks?: ContextBlockForCommitment[]
        profile_ids?: string[]
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
      if (record.state !== HS.PENDING_ACCEPT) {
        return { success: false, error: `Handshake is in state ${record.state}, expected PENDING_ACCEPT` }
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
      const receiverAdhocBlocks = buildContextBlocksFromParams(receiverRawBlocks, undefined)
      const receiverProfileBlocks = resolveProfileIdsToContextBlocks(receiverProfileIds ?? [], session, handshake_id)
      const receiverBlocks = [...receiverAdhocBlocks, ...receiverProfileBlocks]
      for (const b of receiverBlocks) {
        if (!b.scope_id) (b as any).scope_id = 'acceptor'
      }

      // 3. Merge: initiator echoed + receiver's new blocks. Commitment covers all.
      const acceptContextBlocks = [...initiatorBlocks, ...receiverBlocks]
      const { computeContextCommitment: computeCommitment } = await import('./contextCommitment')
      const acceptContextCommitment = acceptContextBlocks.length > 0 ? computeCommitment(acceptContextBlocks) : null

      const capsule = buildAcceptCapsule(session, {
        handshake_id,
        initiatorUserId,
        initiatorEmail,
        sharing_mode,
        context_blocks: acceptContextBlocks,
        context_commitment: acceptContextCommitment,
      })

      // 4. Store initiator block stubs (content NULL, status pending) + receiver blocks (content + pending_delivery)
      const relationshipId = deriveRelationshipId(initiatorUserId, session.wrdesk_user_id)
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
        })
      }

      let emailResult: any = null
      if (fromAccountId && initiatorEmail) {
        emailResult = await sendCapsuleViaEmail(fromAccountId, initiatorEmail, capsule)
      }

      const localResult = await submitCapsuleViaRpc(capsule, db, session)

      return {
        type: 'handshake-accept-result',
        success: localResult.success,
        handshake_id,
        email_sent: emailResult?.success ?? false,
        email_error: emailResult?.error,
        local_result: localResult,
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

      const capsule = buildRefreshCapsule(session, {
        handshake_id,
        counterpartyUserId,
        counterpartyEmail,
        last_seq_received: record.last_seq_received,
        last_capsule_hash_received: record.last_capsule_hash_received,
        context_block_proofs: context_block_proofs ?? [],
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
      const blocks = queryContextBlocks(db, { handshake_id: req.params.id })
      res.json({ blocks })
    } catch (err: any) {
      res.status(500).json({ error: err?.message })
    }
  })

  app.post('/api/handshake/:id/revoke', async (req: any, res: any) => {
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'vault_locked' })
      await revokeHandshake(db, req.params.id, 'local-user')
      res.json({ success: true })
    } catch (err: any) {
      res.status(500).json({ error: err?.message })
    }
  })
}
