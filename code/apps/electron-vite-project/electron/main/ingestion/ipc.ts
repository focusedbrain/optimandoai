/**
 * Ingestion IPC handlers for WebSocket RPC and HTTP routes.
 *
 * Channels:
 *   - ingestion.ingest: Extension → Main (forward raw external input)
 *   - ingestion-result: Main → Extension (event, ingestion outcome)
 *   - ingestion.quarantine-list: Extension → Main (read-only quarantine list)
 *
 * The extension SHALL NOT:
 *   - Call the handshake layer directly
 *   - Construct ValidatedCapsule instances
 *   - Receive raw capsule data back
 */

import type { RawInput, SourceType, TransportMetadata } from './types'
import { processIncomingInput } from './ingestionPipeline'
import { processHandshakeCapsule } from '../handshake/enforcement'
import { canonicalRebuild } from '../handshake/canonicalRebuild'
import type { SSOSession } from '../handshake/types'
import { buildDefaultReceiverPolicy } from '../handshake/types'
import { migrateHandshakeTables } from '../handshake/db'
import {
  insertQuarantineRecord,
  listQuarantineRecords,
  insertSandboxQueueItem,
  listSandboxQueueItems,
  insertIngestionAuditRecord,
} from './persistenceDb'

const migratedDbs = new WeakSet<object>()

function ensureHandshakeMigration(db: any): void {
  if (!db || migratedDbs.has(db)) return
  migratedDbs.add(db)
  try {
    migrateHandshakeTables(db)
  } catch (err: any) {
    console.warn('[INGESTION IPC] Handshake migration warning:', err?.message)
  }
}

export async function handleIngestionRPC(
  method: string,
  params: any,
  db: any,
  ssoSession?: SSOSession,
): Promise<any> {
  switch (method) {
    case 'ingestion.ingest': {
      const { rawInput, sourceType, transportMeta } = params as {
        rawInput: RawInput;
        sourceType: SourceType;
        transportMeta: TransportMetadata;
      }

      const result = await processIncomingInput(rawInput, sourceType, transportMeta)

      // Always persist audit record if db available
      if (db) {
        try { insertIngestionAuditRecord(db, result.audit) } catch { /* non-fatal */ }
      }

      if (!result.success) {
        if (db) {
          try {
            insertQuarantineRecord(db, {
              raw_input_hash: result.audit.raw_input_hash,
              source_type: result.audit.source_type,
              origin_classification: result.audit.origin_classification,
              input_classification: result.audit.input_classification,
              validation_reason_code: result.validation_reason_code ?? 'INTERNAL_VALIDATION_ERROR',
              validation_details: result.reason,
              provenance_json: JSON.stringify(result.audit),
            })
          } catch { /* dedup via INSERT OR IGNORE */ }
        }
        // Generic client response; include validation_reason_code for mapPipelineError
        return {
          type: 'ingestion-result',
          success: false,
          reason: 'Capsule rejected',
          error: result.reason ?? 'Capsule rejected',
          validation_reason_code: result.validation_reason_code,
        }
      }

      const { distribution } = result

      if (distribution.target === 'handshake_pipeline') {
        if (!db) {
          return {
            type: 'ingestion-result',
            success: false,
            error: 'No active session. Please log in first.',
          }
        }

        ensureHandshakeMigration(db)

        try {
          const receiverPolicy = buildDefaultReceiverPolicy()
          if (!ssoSession) {
            return {
              type: 'ingestion-result',
              success: false,
              error: 'SSO session required for handshake processing',
            }
          }

          // Gate 2: Canonical rebuild — strip unknown fields, reject denied fields,
          // rebuild a new trusted object. The original parsed JSON never passes through.
          const rebuildResult = canonicalRebuild(distribution.validated_capsule.capsule)
          if (!rebuildResult.ok) {
            console.warn('[INGESTION] Gate 2 rejected:', rebuildResult.reason, rebuildResult.field ? `field=${rebuildResult.field}` : '')
            return {
              type: 'ingestion-result',
              success: false,
              error: 'Capsule rejected',
              distribution_target: 'handshake_pipeline',
            }
          }

          // Wrap the canonical capsule back into the ValidatedCapsule envelope
          const canonicalValidated = {
            ...distribution.validated_capsule,
            capsule: rebuildResult.capsule as any,
          }

          const handshakeResult = processHandshakeCapsule(
            db,
            canonicalValidated,
            receiverPolicy,
            ssoSession,
          )

          if (!handshakeResult.success) {
            console.warn('[INGESTION] Handshake rejected:', handshakeResult.reason, handshakeResult.failedStep ?? '', handshakeResult.detail ?? '')
          }
          if (!handshakeResult.success) {
            return {
              type: 'ingestion-result',
              success: false,
              error: 'Capsule rejected',
              reason: handshakeResult.reason,
              handshake_result: handshakeResult,
              distribution_target: 'handshake_pipeline',
            }
          } else {
            // Each side independently sends exactly one context_sync (seq=1) after accept.
            // Both sides reach ACTIVE when they receive the other's seq=1. No reverse needed.
          }
          return {
            type: 'ingestion-result',
            success: handshakeResult.success,
            error: !handshakeResult.success ? 'Capsule rejected' : undefined,
            handshake_result: handshakeResult.success ? handshakeResult : undefined,
            distribution_target: 'handshake_pipeline',
          }
        } catch (err: any) {
          console.error('[INGESTION] Handshake processing error:', err?.message ?? err)
          return {
            type: 'ingestion-result',
            success: false,
            error: 'Capsule rejected',
            distribution_target: 'handshake_pipeline',
          }
        }
      }

      if (distribution.target === 'sandbox_sub_orchestrator') {
        if (db) {
          try {
            insertSandboxQueueItem(db, {
              raw_input_hash: result.audit.raw_input_hash,
              validated_capsule_json: JSON.stringify(distribution.validated_capsule),
              routing_reason: distribution.reason,
            })
          } catch { /* dedup via INSERT OR IGNORE */ }
        }
        return {
          type: 'ingestion-result',
          success: true,
          distribution_target: 'sandbox_sub_orchestrator',
          message: 'Queued for sandbox processing (future workstream)',
        }
      }

      // Quarantine fallback
      if (db) {
        try {
          insertQuarantineRecord(db, {
            raw_input_hash: result.audit.raw_input_hash,
            source_type: result.audit.source_type,
            origin_classification: result.audit.origin_classification,
            input_classification: result.audit.input_classification,
            validation_reason_code: 'INTERNAL_VALIDATION_ERROR',
            provenance_json: JSON.stringify(result.audit),
          })
        } catch { /* non-fatal */ }
      }
      return {
        type: 'ingestion-result',
        success: false,
        distribution_target: 'quarantine',
        reason: 'Capsule quarantined',
      }
    }

    case 'ingestion.quarantine-list': {
      if (!db) return { type: 'ingestion-quarantine-list', items: [] }
      return {
        type: 'ingestion-quarantine-list',
        items: listQuarantineRecords(db, 100),
      }
    }

    case 'ingestion.sandbox-queue': {
      if (!db) return { type: 'ingestion-sandbox-queue', items: [] }
      return {
        type: 'ingestion-sandbox-queue',
        items: listSandboxQueueItems(db, params?.status, 100),
      }
    }

    default:
      return { error: 'unknown_method' }
  }
}

export function registerIngestionRoutes(app: any, getDb: () => any, getSsoSession?: () => SSOSession | undefined): void {
  app.post('/api/ingestion/ingest', async (req: any, res: any) => {
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'vault_locked' })
      const { rawInput, sourceType, transportMeta } = req.body
      const result = await processIncomingInput(rawInput, sourceType, transportMeta)

      try { insertIngestionAuditRecord(db, result.audit) } catch { /* non-fatal */ }

      if (!result.success) {
        try {
          insertQuarantineRecord(db, {
            raw_input_hash: result.audit.raw_input_hash,
            source_type: result.audit.source_type,
            origin_classification: result.audit.origin_classification,
            input_classification: result.audit.input_classification,
            validation_reason_code: result.validation_reason_code ?? 'INTERNAL_VALIDATION_ERROR',
            validation_details: result.reason,
            provenance_json: JSON.stringify(result.audit),
          })
        } catch { /* dedup */ }
        return res.json({
          success: false,
          reason: 'Capsule rejected',
        })
      }

      const { distribution } = result

      if (distribution.target === 'handshake_pipeline') {
        const ssoSession = getSsoSession?.()
        if (ssoSession) {
          ensureHandshakeMigration(db)
          try {
            // Gate 2: Canonical rebuild
            const rebuildResult = canonicalRebuild(distribution.validated_capsule.capsule)
            if (!rebuildResult.ok) {
              console.warn('[INGESTION] Gate 2 rejected:', rebuildResult.reason, rebuildResult.field ? `field=${rebuildResult.field}` : '')
              return res.status(400).json({
                success: false,
                error: 'Capsule rejected',
                distribution_target: 'handshake_pipeline',
              })
            }

            const canonicalValidated = {
              ...distribution.validated_capsule,
              capsule: rebuildResult.capsule as any,
            }

            const receiverPolicy = buildDefaultReceiverPolicy()
            const handshakeResult = processHandshakeCapsule(
              db,
              canonicalValidated,
              receiverPolicy,
              ssoSession,
            )
            if (!handshakeResult.success) {
              console.warn('[INGESTION] Handshake rejected:', handshakeResult.reason, handshakeResult.failedStep ?? '', handshakeResult.detail ?? '')
            } else {
              // Each side independently sends exactly one context_sync (seq=1) after accept.
              // Both sides reach ACTIVE when they receive the other's seq=1. No reverse needed.
            }
            return res.json({
              success: handshakeResult.success,
              error: !handshakeResult.success ? 'Capsule rejected' : undefined,
              handshake_result: handshakeResult.success ? handshakeResult : undefined,
              distribution_target: 'handshake_pipeline',
            })
          } catch (err: any) {
            console.error('[INGESTION] Handshake processing error:', err?.message ?? err)
            return res.status(500).json({
              success: false,
              error: 'Capsule rejected',
              distribution_target: 'handshake_pipeline',
            })
          }
        }
        // No active session — return distribution decision without executing handshake
      }

      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err?.message })
    }
  })

  app.get('/api/ingestion/quarantine', (_req: any, res: any) => {
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'vault_locked' })
      res.json({ items: listQuarantineRecords(db, 100) })
    } catch (err: any) {
      res.status(500).json({ error: err?.message })
    }
  })

  app.get('/api/ingestion/sandbox-queue', (req: any, res: any) => {
    try {
      const db = getDb()
      if (!db) return res.status(503).json({ error: 'vault_locked' })
      res.json({ items: listSandboxQueueItems(db, req.query.status, 100) })
    } catch (err: any) {
      res.status(500).json({ error: err?.message })
    }
  })
}
