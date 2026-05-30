/**
 * Mode-aware ingestion dispatcher — single routing layer for all entry points.
 */

import type { DepackageKeys } from '@repo/pod-client'

import type {
  RawInput,
  SourceType,
  TransportMetadata,
  IngestionResult,
  IngestionAuditRecord,
  ValidationReasonCode,
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
import {
  parsePodDepackagedAttachments,
  type PodDepackagedAttachmentWire,
} from '../email/capsuleExtractedText.js'
import { getIsolationProviderSync } from '../isolation/index.js'
import { IsolationChannelError } from '../isolation/IsolationProvider.js'
import { getHandshakeRecord } from '../handshake/db.js'
import { refreshIngestionMode } from './ingestionModeService.js'
import { isSessionHostFallbackAuthorized } from './sessionHostFallback.js'
import { isEdgeTierActiveForRouting } from '../edge-tier/settings.js'
import {
  DeviceKeyNotFoundError,
  getDeviceX25519KeyPair,
} from '../device-keys/deviceKeyStore.js'
import {
  assertExternalUntrustedViaPodOnly,
  SecurityInvariantError,
} from '../security/securityInvariant.js'

/** Structured depackage failure — shared with P2P inline ingest reporters. */
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

function heldReasonCode(snap: {
  mode: string
  blockedReason: string | null
}): ValidationReasonCode {
  if (snap.blockedReason === 'pod_required') return 'POD_REQUIRED'
  return 'EDGE_UNREACHABLE'
}

function heldAudit(
  sourceType: SourceType,
  heldId: string,
  durationMs: number,
  reasonCode: ValidationReasonCode,
): IngestionAuditRecord {
  return {
    timestamp: new Date().toISOString(),
    raw_input_hash: `held:${heldId}`,
    source_type: sourceType,
    origin_classification: sourceType === 'internal' ? 'internal' : 'external',
    input_classification: 'plain_external_content',
    validation_result: 'error',
    validation_reason_code: reasonCode,
    processing_duration_ms: durationMs,
    pipeline_version: INGESTION_CONSTANTS.PIPELINE_VERSION,
  }
}

async function enqueueHeld(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
  reasonCode: ValidationReasonCode,
  start: number,
  useStartupHold: boolean,
): Promise<IngestionResult> {
  const id = generateHoldMessageId()
  const body = Buffer.isBuffer(rawInput.body) ? rawInput.body : Buffer.from(rawInput.body, 'utf8')
  const entry = {
    id,
    receivedAt: Date.now(),
    sourceType,
    transportMeta,
    opaqueBody: serializeOpaqueHoldPayload(body, sourceType, transportMeta),
  }
  if (useStartupHold) {
    enqueueStartupHold(entry)
  } else {
    await holdQueueEnqueue(entry)
    await refreshIngestionMode()
  }
  return {
    success: true,
    held: true,
    heldMessageId: id,
    audit: heldAudit(sourceType, id, Math.round(performance.now() - start), reasonCode),
  }
}

export async function dispatchProcessIncomingInput(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
): Promise<IngestionResult> {
  const start = performance.now()

  if (sourceType === 'internal') {
    return processIncomingInputInProcess(rawInput, sourceType, transportMeta)
  }

  const snap = await getCurrentIngestionMode()
  assertExternalUntrustedViaPodOnly(snap.mode)
  const holdCode = heldReasonCode(snap)

  if (snap.hostPodVariant === 'halted_by_anomaly') {
    return enqueueHeld(rawInput, sourceType, transportMeta, holdCode, start, false)
  }

  if (snap.mode === 'Blocked') {
    return enqueueHeld(rawInput, sourceType, transportMeta, holdCode, start, false)
  }

  if (snap.waitForHostPod) {
    return enqueueHeld(rawInput, sourceType, transportMeta, 'POD_REQUIRED', start, true)
  }

  switch (snap.mode) {
    case 'EdgeActive':
      console.log('[ingestion-dispatch] EdgeActive path')
      return processIncomingInputViaPod(rawInput, sourceType, transportMeta, 'default')
    case 'HostPodActive':
      console.log('[ingestion-dispatch] HostPodActive path')
      return processIncomingInputViaPod(rawInput, sourceType, transportMeta, 'native_beap')
    default: {
      const _exhaustive: never = snap.mode
      throw new SecurityInvariantError(
        `dispatchProcessIncomingInput unreachable mode: ${String(_exhaustive)}`,
      )
    }
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

function parseDepackagedFromPodIngestBody(
  podBody: Record<string, unknown>,
): DepackagedQBeapResult | null {
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

/**
 * Depackage qBEAP/pBEAP via pod ingestor — host→pod over IsolationProvider exec channel
 * (NOT host TCP to 127.0.0.1:18100; same fix pattern as PDF extract-pdf).
 */
async function depackageViaPodExec(
  packageJson: string,
  depackageKeys: DepackageKeys,
): Promise<DepackagedQBeapResult | null> {
  const provider = getIsolationProviderSync()
  const envelope = {
    body: packageJson,
    source_type: 'p2p' as const,
    depackage_keys: depackageKeys,
  }
  const responseBytes = await provider.callPipeline(
    'ingestor',
    'p2p-ingest',
    Buffer.from(JSON.stringify(envelope), 'utf8'),
  )
  let podBody: Record<string, unknown>
  try {
    podBody = JSON.parse(responseBytes.toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
  return parseDepackagedFromPodIngestBody(podBody)
}

/**
 * Depackage inbound qBEAP/pBEAP wire packages — pod only; no main-process decrypt.
 */
export async function dispatchDepackageQBeap(
  packageJson: string,
  handshakeId: string,
  db: unknown,
  opts?: { reportFailure?: (info: QbeapDepackageFailureReport) => void },
): Promise<DepackagedQBeapResult | null> {
  const snap = await getCurrentIngestionMode()
  assertExternalUntrustedViaPodOnly(snap.mode)

  if (snap.mode === 'Blocked') {
    const code =
      snap.blockedReason === 'pod_required' ? 'pod_required' : 'held_blocked_edge_unreachable'
    opts?.reportFailure?.({ code, handshakeId, retryable: true })
    return null
  }

  if (snap.waitForHostPod) {
    opts?.reportFailure?.({ code: 'host_pod_starting', handshakeId, retryable: true })
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

  try {
    return await depackageViaPodExec(packageJson, depackageKeys)
  } catch (err) {
    const msg =
      err instanceof IsolationChannelError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err)
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
