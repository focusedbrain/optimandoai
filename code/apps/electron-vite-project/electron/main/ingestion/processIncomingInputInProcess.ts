/**
 * In-process ingestion path (LegacyInProcess mode) — restored from main pre-P1.12.
 */

import type {
  RawInput,
  SourceType,
  TransportMetadata,
  IngestionResult,
  IngestionAuditRecord,
  DistributionDecision,
  OriginClassification,
  InputClassification,
} from './types'
import { INGESTION_CONSTANTS } from './types'
import {
  ingestInput,
  validateCapsule,
  routeValidatedCapsule,
  prepareCoordinationRelayNativeBeapRawInput,
} from '@repo/ingestion-core'

function buildAuditRecord(
  rawInputHash: string,
  sourceType: SourceType,
  originClassification: OriginClassification,
  inputClassification: InputClassification,
  validationResult: 'validated' | 'rejected' | 'error' | 'held',
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
    validation_result: validationResult === 'held' ? 'error' : validationResult,
    validation_reason_code: validationReasonCode as IngestionAuditRecord['validation_reason_code'],
    distribution_target: distributionTarget as IngestionAuditRecord['distribution_target'],
    processing_duration_ms: durationMs,
    pipeline_version: INGESTION_CONSTANTS.PIPELINE_VERSION,
  }
}

export async function processIncomingInputInProcess(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
): Promise<IngestionResult> {
  const startTime = performance.now()
  const originClassification: OriginClassification =
    sourceType === 'internal' ? 'internal' : 'external'

  try {
    const inputForIngest =
      sourceType === 'coordination_ws'
        ? prepareCoordinationRelayNativeBeapRawInput(rawInput)
        : rawInput
    const candidate = ingestInput(inputForIngest, sourceType, transportMeta)

    const postIngestMs = performance.now() - startTime
    if (postIngestMs > INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS) {
      return {
        success: false,
        reason: `Pipeline timeout exceeded (${Math.round(postIngestMs)}ms > ${INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS}ms)`,
        audit: buildAuditRecord(
          candidate.provenance.raw_input_hash,
          candidate.provenance.source_type,
          candidate.provenance.origin_classification,
          candidate.provenance.input_classification,
          'error',
          Math.round(postIngestMs),
        ),
      }
    }

    const validationResult = validateCapsule(candidate)
    const durationMs = Math.round(performance.now() - startTime)

    if (durationMs > INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS) {
      return {
        success: false,
        reason: `Pipeline timeout exceeded (${durationMs}ms > ${INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS}ms)`,
        audit: buildAuditRecord(
          candidate.provenance.raw_input_hash,
          candidate.provenance.source_type,
          candidate.provenance.origin_classification,
          candidate.provenance.input_classification,
          'error',
          durationMs,
        ),
      }
    }

    if (!validationResult.success) {
      return {
        success: false,
        reason: validationResult.details,
        validation_reason_code: validationResult.reason,
        audit: buildAuditRecord(
          candidate.provenance.raw_input_hash,
          candidate.provenance.source_type,
          candidate.provenance.origin_classification,
          candidate.provenance.input_classification,
          'rejected',
          durationMs,
          validationResult.reason,
        ),
      }
    }

    const distribution: DistributionDecision = routeValidatedCapsule(validationResult.validated)
    const finalDurationMs = Math.round(performance.now() - startTime)

    return {
      success: true,
      distribution,
      audit: buildAuditRecord(
        candidate.provenance.raw_input_hash,
        candidate.provenance.source_type,
        candidate.provenance.origin_classification,
        candidate.provenance.input_classification,
        'validated',
        finalDurationMs,
        undefined,
        distribution.target,
      ),
    }
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - startTime)
    const msg = err instanceof Error ? err.message : 'Unhandled ingestion pipeline error'
    return {
      success: false,
      reason: msg,
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
}
