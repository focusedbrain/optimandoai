/**
 * Stage 1: Ingestor
 *
 * Accepts raw input from any source. Classifies input, extracts BEAP capsule if present.
 * Produces a CandidateCapsuleEnvelope.
 *
 * SHALL NOT: perform validation, check handshake state, or call handshake functions.
 */

import type {
  RawInput,
  SourceType,
  TransportMetadata,
  CandidateCapsuleEnvelope,
  InputClassification,
} from './types.js';
import { INGESTION_CONSTANTS } from './types.js';
import { detectBeapCapsule } from './beapDetection.js';
import { buildPlainDraftPayload } from './plainTransform.js';
import {
  computeRawInputHash,
  buildProvenanceMetadata,
  buildTransportMetadata,
} from './provenanceMetadata.js';

export function ingestInput(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta?: Partial<TransportMetadata>,
): CandidateCapsuleEnvelope {
  const rawSize =
    typeof rawInput.body === 'string' ? Buffer.byteLength(rawInput.body) : rawInput.body.length;
  if (rawSize > INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES) {
    const errProvenance = buildProvenanceMetadata(
      sourceType,
      { ...buildTransportMetadata(rawInput, sourceType), ...transportMeta },
      'plain_external_content',
      'size_exceeded',
    );
    return {
      __brand: 'CandidateCapsule',
      provenance: errProvenance,
      raw_payload: null,
      ingestion_error_flag: true,
      ingestion_error_details: `Raw input size ${rawSize} exceeds limit ${INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES}`,
    };
  }

  const rawInputHash = computeRawInputHash(rawInput);
  const fullTransportMeta = {
    ...buildTransportMetadata(rawInput, sourceType),
    ...transportMeta,
  };

  const detection = detectBeapCapsule(rawInput);

  if (detection.detected) {
    const classification: InputClassification = 'beap_capsule_present';
    const provenance = buildProvenanceMetadata(
      sourceType,
      fullTransportMeta,
      classification,
      rawInputHash,
    );
    return {
      __brand: 'CandidateCapsule',
      provenance,
      raw_payload: detection.raw_capsule_json,
      ingestion_error_flag: false,
    };
  }

  if (detection.malformed) {
    const classification: InputClassification = 'beap_capsule_malformed';
    const provenance = buildProvenanceMetadata(
      sourceType,
      fullTransportMeta,
      classification,
      rawInputHash,
    );
    return {
      __brand: 'CandidateCapsule',
      provenance,
      raw_payload: null,
      ingestion_error_flag: true,
      ingestion_error_details: detection.detection_error ?? 'Malformed BEAP capsule detected',
    };
  }

  const classification: InputClassification = 'plain_external_content';
  const provenance = buildProvenanceMetadata(
    sourceType,
    fullTransportMeta,
    classification,
    rawInputHash,
  );
  return {
    __brand: 'CandidateCapsule',
    provenance,
    raw_payload: buildPlainDraftPayload(rawInput.body),
    ingestion_error_flag: false,
  };
}
