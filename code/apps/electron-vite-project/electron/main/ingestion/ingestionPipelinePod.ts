/**
 * Pod HTTP ingestion path — used by EdgeActive and HostPodActive modes only.
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
import { routeValidatedCapsule } from '@repo/ingestion-core'
import { PodIngestHttpError, PodEdgeUnreachableError } from '@repo/pod-client'
import { buildIngestPodClient, type IngestPodClientRoute } from './podClientFactory.js'

export async function processIncomingInputViaPod(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
  route: IngestPodClientRoute = 'default',
): Promise<IngestionResult> {
  const startTime = performance.now()
  const originClassification: OriginClassification =
    sourceType === 'internal' ? 'internal' : 'external'

  if (!rawInput) {
    const durationMs = Math.round(performance.now() - startTime)
    return {
      success: false,
      reason: 'null rawInput',
      audit: buildAuditRecord(
        'error',
        sourceType,
        originClassification,
        'plain_external_content',
        'error',
        durationMs,
      ),
    }
  }

  const bodyStr = Buffer.isBuffer(rawInput.body)
    ? rawInput.body.toString('base64')
    : rawInput.body

  const bodyByteLength = Buffer.byteLength(bodyStr, 'utf8')
  if (bodyByteLength > INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES) {
    const durationMs = Math.round(performance.now() - startTime)
    return {
      success: false,
      validation_reason_code: 'INGESTION_ERROR_PROPAGATED',
      reason: `Input body (${bodyByteLength} bytes) exceeds limit of ${INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES} bytes`,
      audit: buildAuditRecord(
        'rejected',
        sourceType,
        originClassification,
        'plain_external_content',
        'rejected',
        durationMs,
      ),
    }
  }

  let podBody: unknown
  let podStatus: number

  try {
    const client = buildIngestPodClient(route)
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
    if (err instanceof PodEdgeUnreachableError) {
      console.error(`[pod-hot-path] edge unreachable: ${err.message}`)
      return {
        success: false,
        validation_reason_code: 'EDGE_UNREACHABLE' as ValidationReasonCode,
        reason: err.message,
        audit: buildAuditRecord(
          'edge_unreachable',
          sourceType,
          originClassification,
          'plain_external_content',
          'rejected',
          durationMs,
          'EDGE_UNREACHABLE',
        ),
      }
    }
    if (err instanceof PodIngestHttpError) {
      podBody = err.body
      podStatus = err.status
    } else {
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

function mapPodBodyToIngestionResult(
  podBody: unknown,
  podStatus: number,
  sourceType: SourceType,
  originClassification: OriginClassification,
  startTime: number,
): IngestionResult {
  const durationMs = Math.round(performance.now() - startTime)
  const body = (podBody ?? {}) as Record<string, unknown>

  if (body['verification_failed'] === true && typeof body['reason'] === 'string') {
    const reason = body['reason'] as ValidationReasonCode
    const details =
      typeof body['error'] === 'string' ? body['error'] : `Verification failed: ${reason}`
    return {
      success: false,
      reason: details,
      validation_reason_code: reason,
      audit: buildAuditRecord(
        'pod_cert_rejected',
        sourceType,
        originClassification,
        'plain_external_content',
        'rejected',
        durationMs,
        reason,
      ),
    }
  }

  if (body['valid'] === false) {
    const reason = body['reason'] as ValidationReasonCode | undefined
    const details = typeof body['details'] === 'string' ? body['details'] : 'Validation failed'
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

  if (body['valid'] === true && body['validated'] != null) {
    type PodValidated = import('@repo/ingestion-core').ValidatedCapsule
    const validated = body['validated'] as unknown as PodValidated
    const inputClass: InputClassification =
      (validated.provenance?.input_classification as InputClassification | undefined) ??
      'beap_capsule_present'
    const rawHash = validated.provenance?.raw_input_hash ?? 'pod_ok'

    try {
      const distribution: DistributionDecision = routeValidatedCapsule(validated)
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

  const errMsg =
    typeof body['error'] === 'string'
      ? body['error']
      : `Unexpected pod response (HTTP ${podStatus})`
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

function buildAuditRecord(
  rawInputHash: string,
  sourceType: SourceType,
  originClassification: OriginClassification,
  inputClassification: InputClassification,
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
    validation_reason_code: validationReasonCode as IngestionAuditRecord['validation_reason_code'],
    distribution_target: distributionTarget as IngestionAuditRecord['distribution_target'],
    processing_duration_ms: durationMs,
    pipeline_version: INGESTION_CONSTANTS.PIPELINE_VERSION,
  }
}
