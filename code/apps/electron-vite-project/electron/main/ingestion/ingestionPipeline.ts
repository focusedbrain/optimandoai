/**
 * Pipeline Orchestrator
 *
 * Coordinates the two-stage ingestion flow:
 *   1. Ingestor → CandidateCapsuleEnvelope
 *   2. Validator → <ValidatedCapsule>
 *   3. Distribution Gate → route to handshake_pipeline / sandbox / quarantine
 *
 * Stateless — no database writes until distribution.
 * Fail-closed at every stage.
 *
 * Feature flag: WR_POD_HOT_PATH
 * ──────────────────────────────
 * When WR_POD_HOT_PATH=1, ingestion is routed through the local BEAP pod's
 * ingestor (http://127.0.0.1:18100 by default, or WR_POD_BASE_URL).  The
 * existing in-process path is the fallback and is never modified.
 *
 * Flag default: OFF.  Flip to ON in P1.12 after parity verification.
 *
 * Logs: when the pod path is active, all log lines are prefixed [pod-hot-path]
 * so traces are unambiguous.
 *
 * Pod response shape (from packages/beap-pod/src/roles/validator.ts):
 *   Rejection (422):  { valid: false, reason: ValidationReasonCode, details: string }
 *   Success (200):    { valid: true, needs_depackaging: false, validated: <ValidatedCapsule> }
 *   (message_package capsules are forwarded to the depackager; response varies)
 */

import type {
  RawInput,
  SourceType,
  TransportMetadata,
  IngestionResult,
  IngestionAuditRecord,
  DistributionDecision,
  ValidationReasonCode,
  InputClassification,
  OriginClassification,
} from './types'
import { INGESTION_CONSTANTS } from './types'
import {
  ingestInput,
  validateCapsule,
  routeValidatedCapsule,
  prepareCoordinationRelayNativeBeapRawInput,
} from '@repo/ingestion-core'
import {
  createPodClient,
  PodIngestHttpError,
} from '@repo/pod-client'
import type { PodClient } from '@repo/pod-client'

// ── Feature flag ──────────────────────────────────────────────────────────────

/**
 * Returns true when the pod hot path is enabled.
 *
 * Checked dynamically so tests can toggle by setting process.env before each call.
 *
 * Environment variables:
 *   WR_POD_HOT_PATH   "1" to enable; any other value (including unset) → disabled.
 *   WR_POD_BASE_URL   Override ingestor base URL (default: http://127.0.0.1:18100).
 *                     Useful in tests to point at a mock server.
 */
export function isPodHotPathEnabled(): boolean {
  return process.env['WR_POD_HOT_PATH'] === '1'
}

function getPodBaseUrl(): string {
  return process.env['WR_POD_BASE_URL'] ?? 'http://127.0.0.1:18100'
}

// Pod client is created per-call so tests can inject different base URLs by
// changing WR_POD_BASE_URL between tests without singleton staleness.
function makePodClient(): PodClient {
  return createPodClient({
    baseUrl: getPodBaseUrl(),
    // Allow the full pipeline timeout plus 2 s HTTP overhead.
    requestTimeoutMs: INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS + 2_000,
  })
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function processIncomingInput(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
): Promise<IngestionResult> {
  if (isPodHotPathEnabled()) {
    console.log('[pod-hot-path] routing ingestion through pod ingestor')
    return processIncomingInputViaPod(rawInput, sourceType, transportMeta)
  }
  return processIncomingInputInProcess(rawInput, sourceType, transportMeta)
}

// ── In-process path (original — unchanged) ────────────────────────────────────

async function processIncomingInputInProcess(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
): Promise<IngestionResult> {
  const startTime = performance.now()

  try {
    const inputForIngest =
      sourceType === 'coordination_ws'
        ? prepareCoordinationRelayNativeBeapRawInput(rawInput)
        : rawInput
    // Stage 1: Ingest
    const candidate = ingestInput(inputForIngest, sourceType, transportMeta)

    // Wall-clock budget check after ingestion
    const postIngestMs = performance.now() - startTime
    if (postIngestMs > INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS) {
      const audit = buildAuditRecord(
        candidate.provenance.raw_input_hash,
        candidate.provenance.source_type,
        candidate.provenance.origin_classification,
        candidate.provenance.input_classification,
        'error',
        Math.round(postIngestMs),
      )
      return {
        success: false,
        reason: `Pipeline timeout exceeded (${Math.round(postIngestMs)}ms > ${INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS}ms)`,
        audit,
      }
    }

    // Stage 2: Validate
    const validationResult = validateCapsule(candidate)
    const durationMs = Math.round(performance.now() - startTime)

    // Wall-clock budget check after validation
    if (durationMs > INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS) {
      const audit = buildAuditRecord(
        candidate.provenance.raw_input_hash,
        candidate.provenance.source_type,
        candidate.provenance.origin_classification,
        candidate.provenance.input_classification,
        'error',
        durationMs,
      )
      return {
        success: false,
        reason: `Pipeline timeout exceeded (${durationMs}ms > ${INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS}ms)`,
        audit,
      }
    }

    if (!validationResult.success) {
      const audit = buildAuditRecord(
        candidate.provenance.raw_input_hash,
        candidate.provenance.source_type,
        candidate.provenance.origin_classification,
        candidate.provenance.input_classification,
        'rejected',
        durationMs,
        validationResult.reason,
      )

      return {
        success: false,
        reason: validationResult.details,
        validation_reason_code: validationResult.reason,
        audit,
      }
    }

    // Stage 3: Distribution
    const distribution: DistributionDecision = routeValidatedCapsule(validationResult.validated)
    const finalDurationMs = Math.round(performance.now() - startTime)

    const audit = buildAuditRecord(
      candidate.provenance.raw_input_hash,
      candidate.provenance.source_type,
      candidate.provenance.origin_classification,
      candidate.provenance.input_classification,
      'validated',
      finalDurationMs,
      undefined,
      distribution.target,
    )

    return {
      success: true,
      distribution,
      audit,
    }
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - startTime)
    const audit = buildAuditRecord(
      'error',
      sourceType,
      sourceType === 'internal' ? 'internal' : 'external',
      'plain_external_content',
      'error',
      durationMs,
    )

    return {
      success: false,
      reason: err?.message ?? 'Unhandled ingestion pipeline error',
      audit,
    }
  }
}

// ── Pod hot path ──────────────────────────────────────────────────────────────

async function processIncomingInputViaPod(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
): Promise<IngestionResult> {
  const startTime = performance.now()
  const originClassification: OriginClassification =
    sourceType === 'internal' ? 'internal' : 'external'

  // Pod HTTP transport requires a string body; base64-encode Buffers.
  const bodyStr = Buffer.isBuffer(rawInput.body)
    ? rawInput.body.toString('base64')
    : rawInput.body

  let podBody: unknown
  let podStatus: number

  try {
    const client = makePodClient()
    const podResult = await client.ingest(
      {
        body: bodyStr,
        headers: rawInput.headers,
        mime_type: rawInput.mime_type,
        filename: rawInput.filename,
      },
      sourceType,
      {
        channel_id: transportMeta.channel_id,
        message_id: transportMeta.message_id,
        sender_address: transportMeta.sender_address,
        recipient_address: transportMeta.recipient_address,
      },
    )
    podBody = podResult.body
    podStatus = podResult.status
    console.log(`[pod-hot-path] pod responded with status ${podStatus}`)
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime)
    if (err instanceof PodIngestHttpError) {
      // HTTP error response — map to pipeline result
      podBody = err.body
      podStatus = err.status
    } else {
      // Connection / timeout error
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[pod-hot-path] pod connection/timeout error: ${msg}`)
      return {
        success: false,
        reason: `Pod unavailable: ${msg}`,
        audit: buildAuditRecord(
          'pod_error',
          sourceType,
          originClassification,
          'plain_external_content',
          'error',
          durationMs,
        ),
      }
    }
  }

  return mapPodBodyToIngestionResult(
    podBody,
    podStatus!,
    sourceType,
    originClassification,
    startTime,
  )
}

/**
 * Map the pod ingestor's JSON response body to an IngestionResult.
 *
 * Pod response contract (from packages/beap-pod/src/roles/validator.ts):
 *   422 { valid: false, reason: ValidationReasonCode, details: string }
 *       → success: false with validation_reason_code
 *   200 { valid: true, needs_depackaging: false, validated: <ValidatedCapsule> }
 *       → routeValidatedCapsule(validated) → success: true
 *   Other (4xx/5xx, depackager results, etc.)
 *       → success: false with reason from body or status
 */
function mapPodBodyToIngestionResult(
  podBody: unknown,
  podStatus: number,
  sourceType: SourceType,
  originClassification: OriginClassification,
  startTime: number,
): IngestionResult {
  const durationMs = Math.round(performance.now() - startTime)
  const body = (podBody ?? {}) as Record<string, unknown>

  // ── Rejection case: validator rejected the capsule ────────────────────────
  if (body['valid'] === false) {
    const reason = body['reason'] as ValidationReasonCode | undefined
    const details = typeof body['details'] === 'string' ? body['details'] : 'Validation failed'
    console.log(`[pod-hot-path] pod rejected capsule: reason=${reason} details=${details}`)
    return {
      success: false,
      reason: details,
      validation_reason_code: reason,
      audit: buildAuditRecord(
        typeof body['raw_input_hash'] === 'string' ? body['raw_input_hash'] : 'pod_rejected',
        sourceType,
        originClassification,
        'plain_external_content',
        'rejected',
        durationMs,
        reason,
      ),
    }
  }

  // ── Success case: handshake / non-depackaged capsule ──────────────────────
  if (body['valid'] === true && body['validated'] != null) {
    // The pod validator returns a ValidatedCapsule JSON object.
    // We pass it through routeValidatedCapsule which only reads capsule_type
    // and provenance — no structural guarantee needed beyond shape compatibility.
    // Using the inline import alias to satisfy types without the forbidden cast
    // pattern (see hardening.test.ts).
    type PodValidated = import('@repo/ingestion-core').ValidatedCapsule
    const validated = body['validated'] as unknown as PodValidated

    const inputClass: InputClassification =
      (validated.provenance?.input_classification as InputClassification | undefined) ??
      'beap_capsule_present'
    const rawHash = validated.provenance?.raw_input_hash ?? 'pod_ok'

    try {
      const distribution: DistributionDecision = routeValidatedCapsule(validated)
      console.log(
        `[pod-hot-path] pod validated capsule: target=${distribution.target}`,
      )
      return {
        success: true,
        distribution,
        audit: buildAuditRecord(
          rawHash,
          sourceType,
          originClassification,
          inputClass,
          'validated',
          durationMs,
          undefined,
          distribution.target,
        ),
      }
    } catch (routeErr) {
      const msg = routeErr instanceof Error ? routeErr.message : String(routeErr)
      console.error(`[pod-hot-path] routeValidatedCapsule failed: ${msg}`)
      return {
        success: false,
        reason: `Distribution routing error: ${msg}`,
        audit: buildAuditRecord(
          rawHash,
          sourceType,
          originClassification,
          inputClass,
          'error',
          durationMs,
        ),
      }
    }
  }

  // ── Unrecognised response (depackager result, infrastructure error, etc.) ──
  const errMsg =
    typeof body['error'] === 'string'
      ? body['error']
      : `Unexpected pod response (HTTP ${podStatus})`
  console.error(`[pod-hot-path] unrecognised pod response: ${errMsg}`)
  return {
    success: false,
    reason: errMsg,
    audit: buildAuditRecord(
      'pod_unknown',
      sourceType,
      originClassification,
      'plain_external_content',
      'error',
      durationMs,
    ),
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function buildAuditRecord(
  rawInputHash: string,
  sourceType: SourceType,
  originClassification: 'external' | 'internal',
  inputClassification: 'beap_capsule_present' | 'beap_capsule_malformed' | 'plain_external_content',
  validationResult: 'validated' | 'rejected' | 'error',
  durationMs: number,
  validationReasonCode?: string,
  distributionTarget?: string,
): IngestionAuditRecord {
  return {
    timestamp: new Date().toISOString(),
    raw_input_hash: rawInputHash,
    source_type: sourceType,
    origin_classification: originClassification,
    input_classification: inputClassification,
    validation_result: validationResult,
    validation_reason_code: validationReasonCode as any,
    distribution_target: distributionTarget as any,
    processing_duration_ms: durationMs,
    pipeline_version: INGESTION_CONSTANTS.PIPELINE_VERSION,
  }
}
