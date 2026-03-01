/**
 * Handshake IPC handlers for WebSocket RPC and HTTP routes.
 *
 * WebSocket RPC methods: handshake.*
 * HTTP routes: /api/handshake/*
 */

import type { HandshakeState, SSOSession, ContextBlockInput, HandshakeRecord } from './types'
import { ReasonCode, HandshakeState as HS } from './types'
import { buildCombinedContextText, normalizeAdHocContext } from '../vault/hsContextNormalize'
import { resolveProfilesForHandshake } from '../vault/hsContextProfileService'
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
        context_blocks: clientContextBlocks,
        profile_ids: profileIds,
        ad_hoc_context: adHocContext,
        tier: clientTier,
      } = params as {
        receiverUserId: string
        receiverEmail: string
        fromAccountId: string
        context_blocks?: ContextBlockInput[]
        profile_ids?: string[]
        ad_hoc_context?: string
        tier?: string
      }

      if (!receiverUserId || !receiverEmail) {
        return { success: false, error: 'receiverUserId and receiverEmail are required' }
      }

      let session: SSOSession
      try { session = requireSession() } catch (err: any) {
        return { success: false, error: err.message }
      }

      // ── Server-side profile resolution ──
      // If the client supplied profile IDs, resolve them server-side into
      // normalized plain text. The client cannot be trusted for profile content.
      let resolvedContextBlocks: ContextBlockInput[] = clientContextBlocks ?? []

      if (profileIds && profileIds.length > 0) {
        try {
          const effectiveTier = (session.plan ?? clientTier ?? 'free') as any
          const resolvedProfiles = resolveProfilesForHandshake(db, effectiveTier, profileIds)
          const combinedText = buildCombinedContextText(
            resolvedProfiles,
            adHocContext,
          )

          if (combinedText.trim()) {
            // Build a single context block from the combined normalized text
            const encoder = new TextEncoder()
            const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(combinedText))
            const blockHash = Buffer.from(hashBuffer).toString('hex')

            resolvedContextBlocks = [
              {
                block_id: `blk_${blockHash.slice(0, 12)}`,
                block_hash: blockHash,
                relationship_id: '',
                handshake_id: '',
                type: 'hs_context_profile',
                data_classification: 'business-confidential',
                version: 1,
                payload: combinedText,
              },
            ]
          }
        } catch (profileErr: any) {
          console.warn('[HS IPC] Profile resolution failed (non-fatal):', profileErr?.message)
          // Fall through with no profile context
        }
      } else if (adHocContext?.trim() && resolvedContextBlocks.length === 0) {
        // Normalize ad-hoc context if no profiles and no pre-built blocks
        const normalized = normalizeAdHocContext(adHocContext)
        if (normalized) {
          const encoder = new TextEncoder()
          const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(normalized))
          const blockHash = Buffer.from(hashBuffer).toString('hex')
          resolvedContextBlocks = [
            {
              block_id: `blk_${blockHash.slice(0, 12)}`,
              block_hash: blockHash,
              relationship_id: '',
              handshake_id: '',
              type: 'text',
              data_classification: 'business-confidential',
              version: 1,
              payload: normalized,
            },
          ]
        }
      }

      const capsule = buildInitiateCapsule(session, { receiverUserId })

      // Send via email (non-blocking — failure does not prevent local record creation)
      let emailResult: any = null
      if (fromAccountId) {
        emailResult = await sendCapsuleViaEmail(fromAccountId, receiverEmail, capsule)
      }

      const localResult = await submitCapsuleViaRpc(capsule, db, session)

      // If we have resolved context blocks, attach them via a refresh capsule.
      // The initiate capsule does not carry context; refresh is the correct vehicle.
      let contextResult: any = null
      if (localResult.success && resolvedContextBlocks.length > 0) {
        try {
          const record = getHandshakeRecord(db, capsule.handshake_id)
          if (record) {
            const refreshCapsule = buildRefreshCapsule(session, {
              handshake_id: capsule.handshake_id,
              counterpartyUserId: receiverUserId,
              last_seq_received: record.last_seq_received,
              last_capsule_hash_received: record.last_capsule_hash_received,
              context_blocks: resolvedContextBlocks,
            })
            if (fromAccountId) {
              await sendCapsuleViaEmail(fromAccountId, receiverEmail, refreshCapsule).catch(() => {})
            }
            contextResult = await submitCapsuleViaRpc(refreshCapsule, db, session)
          }
        } catch (refreshErr: any) {
          console.warn('[HS IPC] Context refresh failed (non-fatal):', refreshErr?.message)
        }
      }

      return {
        type: 'handshake-initiate-result',
        success: localResult.success,
        handshake_id: capsule.handshake_id,
        email_sent: emailResult?.success ?? false,
        email_error: emailResult?.error,
        local_result: localResult,
        context_attached: contextResult?.success ?? false,
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

      const capsule = buildAcceptCapsule(session, {
        handshake_id,
        initiatorUserId,
        sharing_mode,
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
      const { handshake_id, context_blocks, fromAccountId } = params as {
        handshake_id: string
        context_blocks: ContextBlockInput[]
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
        last_seq_received: record.last_seq_received,
        last_capsule_hash_received: record.last_capsule_hash_received,
        context_blocks: context_blocks ?? [],
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
