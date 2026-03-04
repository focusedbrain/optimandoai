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
  buildAcceptCapsule,
  buildRefreshCapsule,
} from './capsuleBuilder'
import { submitCapsuleViaRpc } from './capsuleTransport'
import { sendCapsuleViaEmail } from './emailTransport'
import { computeBlockHash, type ContextBlockForCommitment } from './contextCommitment'

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

      const capsule = buildInitiateCapsule(session, {
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

      const capsule = buildInitiateCapsule(session, {
        receiverUserId: dlReceiverUserId,
        receiverEmail: dlReceiverEmail,
        ...(dlContextBlocks.length > 0 ? { context_blocks: dlContextBlocks } : {}),
      })
      const localpart = dlReceiverEmail.split('@')[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'unknown'
      const shortHash = capsule.capsule_hash.slice(0, 8)

      return {
        type: 'handshake-build-result',
        success: true,
        handshake_id: capsule.handshake_id,
        capsule_json: JSON.stringify(capsule),
        suggested_filename: `handshake_${localpart}_${shortHash}.beap`,
      }
    }

    case 'handshake.accept': {
      const { handshake_id, sharing_mode, fromAccountId } = params as {
        handshake_id: string
        sharing_mode: 'receive-only' | 'reciprocal'
        fromAccountId: string
      }

      if (!handshake_id || !sharing_mode) {
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

      const initiatorUserId = record.initiator.wrdesk_user_id
      const initiatorEmail = record.initiator.email

      // Query stored context blocks from the initiate capsule to echo them back
      let acceptContextBlocks: ContextBlockForCommitment[] | undefined
      let acceptContextCommitment: string | null = null
      try {
        const stored = queryContextBlocks(db, { handshake_id })
        if (stored.length > 0) {
          acceptContextBlocks = stored.map(b => ({
            block_id: b.block_id,
            block_hash: b.block_hash,
            scope_id: b.scope_id ?? undefined,
            type: b.type,
            content: b.payload_ref,
          }))
          const { computeContextCommitment: computeCommitment } = await import('./contextCommitment')
          acceptContextCommitment = computeCommitment(acceptContextBlocks)
        }
      } catch {
        // Context echo is best-effort; accept proceeds without it
      }

      const capsule = buildAcceptCapsule(session, {
        handshake_id,
        initiatorUserId,
        initiatorEmail,
        sharing_mode,
        context_blocks: acceptContextBlocks,
        context_commitment: acceptContextCommitment,
      })

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
