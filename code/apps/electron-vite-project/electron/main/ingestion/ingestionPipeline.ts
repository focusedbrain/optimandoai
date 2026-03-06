/**
 * Pipeline Orchestrator
 *
 * Coordinates the two-stage ingestion flow:
 *   1. Ingestor → CandidateCapsuleEnvelope
 *   2. Validator → ValidatedCapsule
 *   3. Distribution Gate → route to handshake_pipeline / sandbox / quarantine
 *
 * Stateless — no database writes until distribution.
 * Fail-closed at every stage.
 */

import type {
  RawInput,
  SourceType,
  TransportMetadata,
  IngestionResult,
  IngestionAuditRecord,
  DistributionDecision,
} from './types'
import { INGESTION_CONSTANTS } from './types'
import { ingestInput, validateCapsule, routeValidatedCapsule } from '@repo/ingestion-core'

export async function processIncomingInput(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
): Promise<IngestionResult> {
  const startTime = performance.now()

  try {
    // Stage 1: Ingest
    const candidate = ingestInput(rawInput, sourceType, transportMeta)

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
