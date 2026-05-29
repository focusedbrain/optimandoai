/**
 * Mode-aware ingestion dispatcher — single routing layer for all entry points.
 */

import type { DepackageKeys } from '@repo/pod-client'
import { createPodClient } from '@repo/pod-client'

import type {
  RawInput,
  SourceType,
  TransportMetadata,
  IngestionResult,
  IngestionAuditRecord,
  OriginClassification,
} from './types'
import { INGESTION_CONSTANTS } from './types'
import { getCurrentIngestionMode } from './ingestionModeService.js'
import { processIncomingInputInProcess } from './processIncomingInputInProcess.js'
import { processIncomingInputViaPod } from './ingestionPipelinePod.js'
import {
  generateHoldMessageId,
  holdQueueEnqueue,
  serializeOpaqueHoldPayload,
  deserializeOpaqueHoldPayload,
  holdQueueDrainTo,
  opaqueHoldPayloadHash,
} from './holdQueue.js'
import {
  enqueueStartupHold,
  drainStartupHoldIfReady,
  flushExpiredStartupHold,
} from './startupHoldBuffer.js'
import { buildIngestPodClient, type IngestPodClientRoute } from './podClientFactory.js'
import { decryptQBeapPackage, type DecryptedQBeapContent } from '../beap/decryptQBeapPackage.js'
import {
  parsePodDepackagedAttachments,
  type PodDepackagedAttachmentWire,
} from '../email/capsuleExtractedText.js'
import { getHandshakeRecord } from '../handshake/db.js'
import { refreshIngestionMode } from './ingestionModeService.js'
import { isSessionHostFallbackAuthorized } from './sessionHostFallback.js'
import { isEdgeTierActiveForRouting } from '../edge-tier/settings.js'
import {
  DeviceKeyNotFoundError,
  getDeviceX25519KeyPair,
} from '../device-keys/deviceKeyStore.js'

/** Structured qBEAP depackage failure — shared with decrypt + P2P inline ingest reporters. */
export type QbeapDepackageFailureReport = {
  code: string
  handshakeId: string
  retryable?: boolean
}

/**
 * Resolve receiver X25519 private key: handshake row first, then orchestrator device_keys
 * (new-flow accept stores NULL in local_x25519_private_key_b64 by design).
 */
export async function resolveInboundX25519PrivateKeyB64(hs: {
  local_x25519_private_key_b64?: string | null
}): Promise<string | null> {
  const fromRow = hs.local_x25519_private_key_b64?.trim()
  if (fromRow) return fromRow
  try {
    const deviceKp = await getDeviceX25519KeyPair()
    const fromDevice = deviceKp.privateKey?.trim()
    return fromDevice || null
  } catch (e) {
    if (e instanceof DeviceKeyNotFoundError) return null
    throw e
  }
}

function heldAudit(
  sourceType: SourceType,
  heldId: string,
  durationMs: number,
): IngestionAuditRecord {
  return {
    timestamp: new Date().toISOString(),
    raw_input_hash: `held:${heldId}`,
    source_type: sourceType,
    origin_classification: sourceType === 'internal' ? 'internal' : 'external',
    input_classification: 'plain_external_content',
    validation_result: 'error',
    validation_reason_code: 'EDGE_UNREACHABLE',
    processing_duration_ms: durationMs,
    pipeline_version: INGESTION_CONSTANTS.PIPELINE_VERSION,
  }
}

export async function dispatchProcessIncomingInput(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
): Promise<IngestionResult> {
  const start = performance.now()
  const snap = await getCurrentIngestionMode()

  if (snap.hostPodVariant === 'halted_by_anomaly') {
    const id = generateHoldMessageId()
    const body = Buffer.isBuffer(rawInput.body) ? rawInput.body : Buffer.from(rawInput.body, 'utf8')
    await holdQueueEnqueue({
      id,
      receivedAt: Date.now(),
      sourceType,
      transportMeta,
      opaqueBody: serializeOpaqueHoldPayload(body, sourceType, transportMeta),
    })
    await refreshIngestionMode()
    return {
      success: true,
      held: true,
      heldMessageId: id,
      audit: heldAudit(sourceType, id, Math.round(performance.now() - start)),
    }
  }

  if (snap.mode === 'Blocked') {
    const id = generateHoldMessageId()
    const body = Buffer.isBuffer(rawInput.body) ? rawInput.body : Buffer.from(rawInput.body, 'utf8')
    await holdQueueEnqueue({
      id,
      receivedAt: Date.now(),
      sourceType,
      transportMeta,
      opaqueBody: serializeOpaqueHoldPayload(body, sourceType, transportMeta),
    })
    await refreshIngestionMode()
    return {
      success: true,
      held: true,
      heldMessageId: id,
      audit: heldAudit(sourceType, id, Math.round(performance.now() - start)),
    }
  }

  if (snap.waitForHostPod) {
    const id = generateHoldMessageId()
    const body = Buffer.isBuffer(rawInput.body) ? rawInput.body : Buffer.from(rawInput.body, 'utf8')
    enqueueStartupHold({
      id,
      receivedAt: Date.now(),
      sourceType,
      transportMeta,
      opaqueBody: serializeOpaqueHoldPayload(body, sourceType, transportMeta),
    })
    return {
      success: true,
      held: true,
      heldMessageId: id,
      audit: heldAudit(sourceType, id, Math.round(performance.now() - start)),
    }
  }

  switch (snap.mode) {
    case 'LegacyInProcess':
      console.log('[ingestion-dispatch] LegacyInProcess path')
      return processIncomingInputInProcess(rawInput, sourceType, transportMeta)
    case 'EdgeActive':
      console.log('[ingestion-dispatch] EdgeActive path')
      return processIncomingInputViaPod(rawInput, sourceType, transportMeta, 'default')
    case 'HostPodActive':
      console.log('[ingestion-dispatch] HostPodActive path')
      return processIncomingInputViaPod(rawInput, sourceType, transportMeta, 'native_beap')
    default:
      return processIncomingInputViaPod(rawInput, sourceType, transportMeta, 'default')
  }
}

export interface DepackagedQBeapResult {
  subject: string
  body: string
  transport_plaintext: string
  rawCapsuleJson?: string
  attachments: never[]
  automation: undefined
  /** Pod depackager attachment rows (edge extracted_text_v1 when present). */
  podAttachments?: PodDepackagedAttachmentWire[]
}

function mapDecryptResult(d: DecryptedQBeapContent): DepackagedQBeapResult {
  return {
    subject: d.subject,
    body: d.body,
    transport_plaintext: d.transport_plaintext,
    rawCapsuleJson: d.rawCapsuleJson,
    attachments: [],
    automation: undefined,
  }
}

async function depackageViaPodHttp(
  packageJson: string,
  depackageKeys: DepackageKeys,
  route: IngestPodClientRoute,
): Promise<DepackagedQBeapResult | null> {
  const client = buildIngestPodClient(route)
  const result = await client.ingest({ body: packageJson }, 'p2p', undefined, depackageKeys)
  const podBody = result.body as Record<string, unknown>
  const depackaged = podBody?.['depackaged'] as Record<string, unknown> | undefined
  if (!depackaged || typeof depackaged['rawCapsuleJson'] !== 'string') return null
  return {
    subject: typeof depackaged['subject'] === 'string' ? depackaged['subject'] : '',
    body: typeof depackaged['body'] === 'string' ? depackaged['body'] : '',
    transport_plaintext:
      typeof depackaged['transport_plaintext'] === 'string' ? depackaged['transport_plaintext'] : '',
    rawCapsuleJson: depackaged['rawCapsuleJson'] as string,
    attachments: [],
    automation: undefined,
    podAttachments: parsePodDepackagedAttachments(depackaged),
  }
}

export async function dispatchDepackageQBeap(
  packageJson: string,
  handshakeId: string,
  db: unknown,
  opts?: { reportFailure?: (info: QbeapDepackageFailureReport) => void },
): Promise<DepackagedQBeapResult | null> {
  const snap = await getCurrentIngestionMode()

  if (snap.mode === 'Blocked') {
    opts?.reportFailure?.({ code: 'held_blocked_edge_unreachable', handshakeId, retryable: true })
    return null
  }

  const hs = getHandshakeRecord(db as any, handshakeId.trim())
  if (!hs) {
    opts?.reportFailure?.({ code: 'missing_handshake_record', handshakeId, retryable: false })
    return null
  }
  const x25519PrivB64 = await resolveInboundX25519PrivateKeyB64(hs)
  if (!x25519PrivB64) {
    opts?.reportFailure?.({ code: 'missing_x25519_private_key', handshakeId, retryable: false })
    return null
  }
  const depackageKeys: DepackageKeys = {
    x25519_priv_b64: x25519PrivB64,
    mlkem_secret_b64: hs.local_mlkem768_secret_key_b64?.trim() || undefined,
  }

  if (snap.mode === 'LegacyInProcess') {
    try {
      const dec = await decryptQBeapPackage(packageJson, handshakeId, db, {
        reportFailure: (info) =>
          opts?.reportFailure?.({
            code: info.code,
            handshakeId: info.handshakeId,
            retryable: info.retryable,
          }),
      })
      if (!dec?.rawCapsuleJson) return null
      return mapDecryptResult(dec)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      opts?.reportFailure?.({ code: msg, handshakeId, retryable: false })
      return null
    }
  }

  if (snap.waitForHostPod) {
    opts?.reportFailure?.({ code: 'host_pod_starting', handshakeId, retryable: true })
    return null
  }

  const route: IngestPodClientRoute = snap.mode === 'EdgeActive' ? 'default' : 'native_beap'
  try {
    return await depackageViaPodHttp(packageJson, depackageKeys, route)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    opts?.reportFailure?.({ code: `pod_error: ${msg}`, handshakeId, retryable: false })
    return null
  }
}

export async function drainHoldQueueIfReady(): Promise<void> {
  let snap = await refreshIngestionMode(true)
  if (snap.mode === 'Blocked') return

  await holdQueueDrainTo(async (msg) => {
    const current = await refreshIngestionMode(false)
    if (current.mode === 'Blocked') {
      throw new Error('mode became Blocked during drain')
    }
    if (
      current.mode === 'HostPodActive' &&
      isEdgeTierActiveForRouting(current.settings) &&
      !isSessionHostFallbackAuthorized()
    ) {
      throw new Error('session host fallback revoked during drain')
    }
    const { rawBody, sourceType, transportMeta } = deserializeOpaqueHoldPayload(msg.opaqueBody)
    await dispatchProcessIncomingInput({ body: rawBody }, sourceType, transportMeta)
  }, () => {
    return snap.mode !== 'Blocked'
  })

  snap = await refreshIngestionMode(false)
  const hostReady = snap.probes.hostPodReady
  for (const msg of drainStartupHoldIfReady(hostReady)) {
    const { rawBody, sourceType, transportMeta } = deserializeOpaqueHoldPayload(msg.opaqueBody)
    await dispatchProcessIncomingInput({ body: rawBody }, sourceType, transportMeta)
  }

  for (const msg of flushExpiredStartupHold()) {
    snap = await refreshIngestionMode(false)
    if (snap.mode === 'Blocked') {
      await holdQueueEnqueue(msg)
    } else {
      const { rawBody, sourceType, transportMeta } = deserializeOpaqueHoldPayload(msg.opaqueBody)
      await dispatchProcessIncomingInput({ body: rawBody }, sourceType, transportMeta)
    }
  }
}

export { opaqueHoldPayloadHash }
