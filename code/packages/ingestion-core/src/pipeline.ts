/**
 * Validation Pipeline
 *
 * Orchestrates: Ingestor → Validator → Distribution Gate
 * Pure validation only — no DB, no session, no app state.
 */

import type { RawInput, SourceType, TransportMetadata } from './types.js';
import { INGESTION_CONSTANTS } from './types.js';
import { ingestInput } from './ingestor.js';
import { validateCapsule } from './validator.js';
import { routeValidatedCapsule } from './distributionGate.js';
import {
  isCoordinationRelayNativeBeap,
  normalizeCoordinationRelayNativeBeapWire,
} from './beapDetection.js';

/**
 * Normalize native BEAP wire (string header/metadata) before ingest/validate.
 * Use for `coordination_service` (relay HTTP) and `coordination_ws` (recipient push)
 * so validation matches `isCoordinationRelayNativeBeap`.
 */
export function prepareCoordinationRelayNativeBeapRawInput(rawInput: RawInput): RawInput {
  if (typeof rawInput.body !== 'string') return rawInput;
  const trimmed = rawInput.body.trim();
  if (!trimmed.startsWith('{')) return rawInput;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!isCoordinationRelayNativeBeap(parsed)) return rawInput;
    const norm = normalizeCoordinationRelayNativeBeapWire(parsed);
    return { ...rawInput, body: JSON.stringify(norm) };
  } catch {
    return rawInput;
  }
}

export interface PipelineResult {
  readonly success: boolean;
  readonly validated?: import('./types.js').ValidatedCapsule;
  readonly distribution?: import('./types.js').DistributionDecision;
  readonly reason?: string;
  readonly validation_reason_code?: import('./types.js').ValidationReasonCode;
}

/**
 * Run the full validation pipeline: ingest → validate → distribute.
 * Returns validated capsule and distribution decision on success.
 */
export function validateInput(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta?: Partial<TransportMetadata>,
): PipelineResult {
  const startTime = performance.now();

  try {
    const effectiveInput =
      sourceType === 'coordination_service'
        ? prepareCoordinationRelayNativeBeapRawInput(rawInput)
        : rawInput;
    const candidate = ingestInput(effectiveInput, sourceType, transportMeta);

    const postIngestMs = performance.now() - startTime;
    if (postIngestMs > INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS) {
      return {
        success: false,
        reason: `Pipeline timeout exceeded (${Math.round(postIngestMs)}ms > ${INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS}ms)`,
      };
    }

    const validationResult = validateCapsule(candidate);
    const durationMs = Math.round(performance.now() - startTime);

    if (durationMs > INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS) {
      return {
        success: false,
        reason: `Pipeline timeout exceeded (${durationMs}ms > ${INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS}ms)`,
      };
    }

    if (!validationResult.success) {
      return {
        success: false,
        reason: validationResult.details,
        validation_reason_code: validationResult.reason,
      };
    }

    const distribution = routeValidatedCapsule(validationResult.validated);

    return {
      success: true,
      validated: validationResult.validated,
      distribution,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unhandled pipeline error';
    return { success: false, reason: msg };
  }
}
