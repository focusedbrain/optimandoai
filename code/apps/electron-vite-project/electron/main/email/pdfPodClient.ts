/**
 * On-demand PDF extraction — host→pipeline via IsolationProvider.
 *
 * All host→pipeline I/O goes through the provider returned by
 * getIsolationProviderSync() / resolveIsolationProvider(), which selects the
 * correct backend (podman-exec on build001) at capability-detection time.
 * There is NO direct TCP path to any pod port in this module.
 */

import { getLocalPodUnavailableMessage } from '../local-pod/podStatus.js'
import { getIsolationProviderSync } from '../isolation/index.js'
import { IsolationChannelError } from '../isolation/IsolationProvider.js'

export interface ExtractedTextV1 {
  text: string
  structural_hash: string
  extractor_version: string
}

export type DepackagerExtractResult =
  | { ok: true; extracted_text_v1: ExtractedTextV1; page_count?: number }
  | { ok: false; reason: string; status?: number }

function parseExtractPdfJsonBody(
  raw: string,
  httpOk: boolean,
): DepackagerExtractResult {
  let json: Record<string, unknown>
  try {
    json = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {
      ok: false,
      reason: httpOk ? 'depackager_invalid_response' : 'pdf_parse_unavailable',
      status: httpOk ? 500 : 503,
    }
  }

  if (!httpOk) {
    const reason = typeof json['error'] === 'string' ? json['error'] : 'pdf_parse_unavailable'
    const status =
      typeof json['status'] === 'number'
        ? json['status']
        : reason.includes('malformed') || reason.includes('too_large')
          ? 422
          : 503
    return { ok: false, reason, status }
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

/**
 * Extract PDF text via the active isolation provider.
 *
 * Payload encoding: { message_id, attachment_id, pdf_bytes_b64 } — JSON Buffer.
 * Response:         { extracted_text_v1: { text, structural_hash, extractor_version } }
 *
 * The provider handles backend selection (podman-exec → hyperv → firecracker
 * as higher tiers are implemented). Callers see only this function.
 */
export async function extractPdfViaDepackager(
  pdfBytes: Buffer,
  opts: {
    messageId: string
    attachmentId: string
  },
): Promise<DepackagerExtractResult> {
  const provider = getIsolationProviderSync()

  // Build the payload buffer for ('ingestor', 'extract-pdf').
  const requestPayload = Buffer.from(
    JSON.stringify({
      message_id: opts.messageId,
      attachment_id: opts.attachmentId,
      pdf_bytes_b64: pdfBytes.toString('base64'),
    }),
    'utf8',
  )

  let responseBytes: Buffer
  try {
    responseBytes = await provider.callPipeline('ingestor', 'extract-pdf', requestPayload)
  } catch (e) {
    if (e instanceof IsolationChannelError) {
      const isPodUnavailable =
        e.code === 'podman_session_missing' ||
        e.code === 'podman_unavailable' ||
        e.code === 'exec_failed'
      return {
        ok: false,
        reason: isPodUnavailable ? getLocalPodUnavailableMessage() : e.message,
        status: 503,
      }
    }
    return {
      ok: false,
      reason: e instanceof Error ? e.message : 'pdf_parse_unavailable',
      status: 503,
    }
  }

  return parseExtractPdfJsonBody(responseBytes.toString('utf8'), true)
}
