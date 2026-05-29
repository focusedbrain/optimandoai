/**
 * On-demand PDF extraction via local depackager POST /extract-pdf.
 */

import { getPodSessionAuthSecret } from '../local-pod/podSessionAuth.js'
import { getLocalPodUnavailableMessage } from '../local-pod/podStatus.js'

export const DEFAULT_DEPACKAGER_BASE = 'http://127.0.0.1:18102'

export interface ExtractedTextV1 {
  text: string
  structural_hash: string
  extractor_version: string
}

export type DepackagerExtractResult =
  | { ok: true; extracted_text_v1: ExtractedTextV1; page_count?: number }
  | { ok: false; reason: string; status?: number }

function depackagerBaseUrl(): string {
  return process.env['WR_DEPACKAGER_BASE']?.trim() || DEFAULT_DEPACKAGER_BASE
}

export async function extractPdfViaDepackager(
  pdfBytes: Buffer,
  opts: { messageId: string; attachmentId: string; fetchImpl?: typeof fetch },
): Promise<DepackagerExtractResult> {
  const secret = getPodSessionAuthSecret()
  if (!secret) {
    return { ok: false, reason: getLocalPodUnavailableMessage(), status: 503 }
  }

  const fetchFn = opts.fetchImpl ?? fetch
  const url = `${depackagerBaseUrl().replace(/\/+$/, '')}/extract-pdf`

  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pod-Auth': secret,
      },
      body: JSON.stringify({
        message_id: opts.messageId,
        attachment_id: opts.attachmentId,
        pdf_bytes_b64: pdfBytes.toString('base64'),
      }),
    })
  } catch {
    return { ok: false, reason: 'depackager_unreachable', status: 503 }
  }

  let json: Record<string, unknown>
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'depackager_invalid_response', status: res.status }
  }

  if (!res.ok) {
    const reason = typeof json['error'] === 'string' ? json['error'] : `depackager_${res.status}`
    return { ok: false, reason, status: res.status }
  }

  const v1 = json['extracted_text_v1'] as Record<string, unknown> | undefined
  const text = typeof v1?.['text'] === 'string' ? v1['text'] : ''
  const structural_hash =
    typeof v1?.['structural_hash'] === 'string' ? v1['structural_hash'] : ''
  const extractor_version =
    typeof v1?.['extractor_version'] === 'string' ? v1['extractor_version'] : 'beap-pdf-extract-v1'

  if (!text || !structural_hash) {
    return { ok: false, reason: 'depackager_missing_extraction_fields', status: 500 }
  }

  return {
    ok: true,
    extracted_text_v1: { text, structural_hash, extractor_version },
  }
}
