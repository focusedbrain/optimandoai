/**
 * Provenance metadata construction.
 * Uses Node.js crypto for SHA-256.
 */

import { createHash } from 'node:crypto';
import type {
  ProvenanceMetadata,
  TransportMetadata,
  SourceType,
  InputClassification,
  RawInput,
} from './types.js';
import { INGESTION_CONSTANTS } from './types.js';

export function computeRawInputHash(input: RawInput): string {
  const data = typeof input.body === 'string' ? input.body : input.body;
  return createHash('sha256').update(data).digest('hex');
}

export function deriveOriginClassification(sourceType: SourceType): 'external' | 'internal' {
  if (sourceType === 'internal') return 'internal';
  return 'external';
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
  };
}

export function buildTransportMetadata(rawInput: RawInput, _sourceType: SourceType): TransportMetadata {
  return {
    sender_address: rawInput.headers?.['from'] ?? rawInput.headers?.['From'] ?? undefined,
    recipient_address: rawInput.headers?.['to'] ?? rawInput.headers?.['To'] ?? undefined,
    message_id: rawInput.headers?.['message-id'] ?? rawInput.headers?.['Message-ID'] ?? undefined,
    mime_type: rawInput.mime_type ?? rawInput.headers?.['content-type'] ?? rawInput.headers?.['Content-Type'] ?? undefined,
    content_length: typeof rawInput.body === 'string' ? Buffer.byteLength(rawInput.body) : rawInput.body.length,
  };
}
