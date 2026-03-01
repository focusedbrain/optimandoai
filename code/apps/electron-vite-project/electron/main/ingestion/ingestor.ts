/**
 * Stage 1: Ingestor
 *
 * Accepts raw input from any source (email, file, API, extension, internal).
 * Classifies input, extracts BEAP capsule if present, attaches provenance.
 * Produces a CandidateCapsuleEnvelope.
 *
 * SHALL NOT: perform validation, check handshake state, resolve policy,
 *            verify signatures, execute payloads, or call handshake functions.
 */

import type {
  RawInput,
  SourceType,
  TransportMetadata,
  CandidateCapsuleEnvelope,
  InputClassification,
} from './types'
import { INGESTION_CONSTANTS } from './types'
import { detectBeapCapsule } from './beapDetection'
import { buildPlainDraftPayload } from './plainTransform'
import {
  computeRawInputHash,
  buildProvenanceMetadata,
  buildTransportMetadata,
} from './provenanceMetadata'

export function ingestInput(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta?: Partial<TransportMetadata>,
): CandidateCapsuleEnvelope {
  // Hardening: reject oversized raw input before any parsing
  const rawSize = typeof rawInput.body === 'string'
    ? Buffer.byteLength(rawInput.body)
    : rawInput.body.length
  if (rawSize > INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES) {
    const errProvenance = buildProvenanceMetadata(
      sourceType,
      { ...buildTransportMetadata(rawInput, sourceType), ...transportMeta },
      'plain_external_content',
      'size_exceeded',
    )
    return {
      __brand: 'CandidateCapsule',
      provenance: errProvenance,
      raw_payload: null,
      ingestion_error_flag: true,
      ingestion_error_details: `Raw input size ${rawSize} exceeds limit ${INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES}`,
    }
  }

  const rawInputHash = computeRawInputHash(rawInput)
  const fullTransportMeta = {
    ...buildTransportMetadata(rawInput, sourceType),
    ...transportMeta,
  }

  // Detect BEAP capsule
  const detection = detectBeapCapsule(rawInput)

  if (detection.detected) {
    const classification: InputClassification = 'beap_capsule_present'
    const provenance = buildProvenanceMetadata(
      sourceType, fullTransportMeta, classification, rawInputHash,
    )
    return {
      __brand: 'CandidateCapsule',
      provenance,
      raw_payload: detection.raw_capsule_json,
      ingestion_error_flag: false,
    }
  }

  if (detection.malformed) {
    const classification: InputClassification = 'beap_capsule_malformed'
    const provenance = buildProvenanceMetadata(
      sourceType, fullTransportMeta, classification, rawInputHash,
    )
    return {
      __brand: 'CandidateCapsule',
      provenance,
      raw_payload: null,
      ingestion_error_flag: true,
      ingestion_error_details: detection.detection_error ?? 'Malformed BEAP capsule detected',
    }
  }

  // Plain external content — wrap as internal_draft
  const classification: InputClassification = 'plain_external_content'
  const provenance = buildProvenanceMetadata(
    sourceType, fullTransportMeta, classification, rawInputHash,
  )
  return {
    __brand: 'CandidateCapsule',
    provenance,
    raw_payload: buildPlainDraftPayload(rawInput.body),
    ingestion_error_flag: false,
  }
}
