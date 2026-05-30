/**
 * On-demand PDF extraction via ingestor POST /extract-pdf.
 * Windows: podman exec into ingestor netns (wslrelay published-port transport is broken).
 * In-pod: loopback http://127.0.0.1:18100/extract-pdf → depackager → pdf-parser.
 */

import { getPodSessionAuthSecret } from '../local-pod/podSessionAuth.js'
import { getLocalPodUnavailableMessage } from '../local-pod/podStatus.js'
import {
  runPdfExtractViaPodmanExec,
  type PdfPodExecDeps,
  type PdfPodExecOutcome,
} from './pdfPodExecTransport.js'

export const DEFAULT_POD_BASE = 'http://127.0.0.1:18100'

/** @deprecated Host must use ingestor entry; kept for test overrides only. */
export const DEFAULT_DEPACKAGER_BASE = 'http://127.0.0.1:18102'

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

function mapExecFailure(outcome: Extract<PdfPodExecOutcome, { ok: false }>): DepackagerExtractResult {
  if (outcome.reason === 'podman_exec_failed' || outcome.reason === 'podman_cli_unavailable') {
    return { ok: false, reason: getLocalPodUnavailableMessage(), status: 503 }
  }
  return { ok: false, reason: 'pdf_parse_unavailable', status: 503 }
}

export async function extractPdfViaDepackager(
  pdfBytes: Buffer,
  opts: {
    messageId: string
    attachmentId: string
    execDeps?: PdfPodExecDeps
  },
): Promise<DepackagerExtractResult> {
  const secret = getPodSessionAuthSecret()
  if (!secret) {
    return { ok: false, reason: getLocalPodUnavailableMessage(), status: 503 }
  }

  const execOutcome = await runPdfExtractViaPodmanExec(
    {
      message_id: opts.messageId,
      attachment_id: opts.attachmentId,
      pdf_bytes_b64: pdfBytes.toString('base64'),
    },
    opts.execDeps,
  )

  if (!execOutcome.ok) {
    const body = (execOutcome.stdout || execOutcome.stderr).trim()
    if (body.startsWith('{')) {
      return parseExtractPdfJsonBody(body, false)
    }
    return mapExecFailure(execOutcome)
  }

  return parseExtractPdfJsonBody(execOutcome.stdout.trim(), true)
}
