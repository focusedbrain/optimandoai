/**
 * Provenance metadata construction.
 * Computes SHA-256 of raw input and assembles transport metadata.
 */

import { createHash } from 'crypto'
import type {
  ProvenanceMetadata,
  TransportMetadata,
  SourceType,
  OriginClassification,
  InputClassification,
  RawInput,
} from './types'
import { INGESTION_CONSTANTS } from './types'

export function computeRawInputHash(input: RawInput): string {
  const data = typeof input.body === 'string'
    ? input.body
    : input.body
  return createHash('sha256').update(data).digest('hex')
}

export function deriveOriginClassification(sourceType: SourceType): OriginClassification {
  if (sourceType === 'internal') return 'internal'
  return 'external'
}

export function buildProvenanceMetadata(
  sourceType: SourceType,
  transportMeta: TransportMetadata,
  inputClassification: InputClassification,
  rawInputHash: string,
): ProvenanceMetadata {
  return {
    source_type: sourceType,
    origin_classification: deriveOriginClassification(sourceType),
    ingested_at: new Date().toISOString(),
    transport_metadata: transportMeta,
    input_classification: inputClassification,
    raw_input_hash: rawInputHash,
    ingestor_version: INGESTION_CONSTANTS.INGESTOR_VERSION,
  }
}

export function buildTransportMetadata(
  rawInput: RawInput,
  _sourceType: SourceType,
): TransportMetadata {
  return {
    sender_address: rawInput.headers?.['from'] ?? rawInput.headers?.['From'] ?? undefined,
    recipient_address: rawInput.headers?.['to'] ?? rawInput.headers?.['To'] ?? undefined,
    message_id: rawInput.headers?.['message-id'] ?? rawInput.headers?.['Message-ID'] ?? undefined,
    mime_type: rawInput.mime_type ?? rawInput.headers?.['content-type'] ?? rawInput.headers?.['Content-Type'] ?? undefined,
    content_length: typeof rawInput.body === 'string' ? Buffer.byteLength(rawInput.body) : rawInput.body.length,
  }
}
