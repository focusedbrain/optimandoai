/**
 * Loopback pdf-parser client for the depackager role.
 */

import { podAuthFetch } from './podAuth.js';
import { PDF_EXTRACTOR_VERSION } from './pdfExtractCore.js';

export type PdfParserCallSuccess = {
  ok: true;
  extracted_text: string;
  structural_hash: string;
  extractor_version: string;
  page_count: number;
};

export type PdfParserCallFailure = {
  ok: false;
  reason: string;
  reason_code?: string;
};

export type PdfParserCallResult = PdfParserCallSuccess | PdfParserCallFailure;

export interface PdfParserClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  podAuthSecret?: string;
}

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, '');
}

export async function callPdfParserExtract(
  pdfBytes: Buffer,
  config: PdfParserClientConfig,
): Promise<PdfParserCallResult> {
  const fetchFn =
    config.fetchImpl ??
    (config.podAuthSecret ? podAuthFetch(config.podAuthSecret) : fetch);
  const url = `${normalizeBase(config.baseUrl)}/extract`;

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdf_bytes_b64: pdfBytes.toString('base64') }),
    });
  } catch {
    return { ok: false, reason: 'extractor_unavailable' };
  }

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: res.ok ? 'extractor_invalid_response' : 'extractor_unavailable' };
  }

  if (!res.ok) {
    const reasonCode = typeof json['reason_code'] === 'string' ? json['reason_code'] : undefined;
    const message = typeof json['error'] === 'string' ? json['error'] : `pdf_parser_${res.status}`;
    return {
      ok: false,
      reason: reasonCode ? `${reasonCode}: ${message}` : message,
      reason_code: reasonCode,
    };
  }

  const extracted_text = typeof json['extracted_text'] === 'string' ? json['extracted_text'] : '';
  const structural_hash =
    typeof json['structural_hash'] === 'string' ? json['structural_hash'] : '';
  if (!extracted_text || !structural_hash) {
    return { ok: false, reason: 'extractor_invalid_response' };
  }

  const extractor_version =
    typeof json['extractor_version'] === 'string' && json['extractor_version'].length > 0
      ? json['extractor_version']
      : PDF_EXTRACTOR_VERSION;

  const page_count = typeof json['page_count'] === 'number' ? json['page_count'] : 0;

  return {
    ok: true,
    extracted_text,
    structural_hash,
    extractor_version,
    page_count,
  };
}
