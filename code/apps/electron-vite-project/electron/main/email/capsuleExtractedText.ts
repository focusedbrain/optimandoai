/**
 * Edge capsule extracted_text_v1 handling for host inbox storage.
 */

import { createHash } from 'node:crypto'
import { verifyExtractedTextStructuralHash } from './pdfStructuralHash.js'

export interface ExtractedTextV1Wire {
  text: string
  structural_hash: string
  extractor_version: string
}

export interface PodDepackagedAttachmentWire {
  id: string
  filename?: string
  content_type?: string
  size?: number
  extracted_text_v1?: ExtractedTextV1Wire
  extraction_failed?: { reason: string }
}

export function parsePodDepackagedAttachments(
  depackaged: Record<string, unknown> | undefined,
): PodDepackagedAttachmentWire[] {
  if (!depackaged) return []
  const raw = depackaged['attachments']
  if (!Array.isArray(raw)) return []
  const out: PodDepackagedAttachmentWire[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o['id'] === 'string' ? o['id'] : ''
    if (!id) continue
    const entry: PodDepackagedAttachmentWire = {
      id,
      filename: typeof o['filename'] === 'string' ? o['filename'] : undefined,
      content_type: typeof o['content_type'] === 'string' ? o['content_type'] : undefined,
      size: typeof o['size'] === 'number' ? o['size'] : undefined,
    }
    const v1 = o['extracted_text_v1'] as Record<string, unknown> | undefined
    if (v1 && typeof v1['text'] === 'string' && typeof v1['structural_hash'] === 'string') {
      entry.extracted_text_v1 = {
        text: v1['text'],
        structural_hash: v1['structural_hash'],
        extractor_version:
          typeof v1['extractor_version'] === 'string'
            ? v1['extractor_version']
            : 'beap-pdf-extract-v1',
      }
    }
    const fail = o['extraction_failed'] as Record<string, unknown> | undefined
    if (fail && typeof fail['reason'] === 'string') {
      entry.extraction_failed = { reason: fail['reason'] }
    }
    out.push(entry)
  }
  return out
}

export function verifyEdgeExtractedTextV1(v1: ExtractedTextV1Wire): boolean {
  return verifyExtractedTextStructuralHash(v1.text, v1.structural_hash)
}

export function edgeExtractedTextSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export interface AttMetaExtractionTarget {
  attId: string
  att: { id?: string; contentType?: string; filename?: string }
  extractedText: string | null
  extractionStatus: string | null
  extractionError: string | null
  extractedTextSha256: string | null
}

/** Apply edge pod depackaged attachment extraction onto ingest att metas. */
export function applyEdgePodAttachmentsToAttMetas(
  attMetas: AttMetaExtractionTarget[],
  podAttachments: PodDepackagedAttachmentWire[],
  inboxMessageId: string,
  makeStorageId: (inboxId: string, providerAttId: string | undefined) => string,
): void {
  for (const m of attMetas) {
    const providerId = m.att.id
    const candidates = new Set<string>([
      m.attId,
      ...(providerId ? [providerId, makeStorageId(inboxMessageId, providerId)] : []),
    ])
    const podAtt = podAttachments.find((p) => candidates.has(p.id))
    if (!podAtt?.extracted_text_v1) continue
    const v1 = podAtt.extracted_text_v1
    if (!verifyEdgeExtractedTextV1(v1)) {
      m.extractionStatus = 'failed'
      m.extractionError = 'edge_extracted_text_hash_mismatch'
      continue
    }
    m.extractedText = v1.text
    m.extractedTextSha256 = edgeExtractedTextSha256(v1.text)
    m.extractionStatus = 'edge_extracted'
    m.extractionError = null
  }
}
