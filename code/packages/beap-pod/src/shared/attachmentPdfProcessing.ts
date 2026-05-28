/**
 * PDF attachment processing during depackage (eager) and on-demand extract endpoint.
 */

import { createHash } from 'node:crypto';
import {
  buildExtractedTextV1,
  type DepackagedAttachment,
  isPdfContentType,
  type PdfParserMode,
} from './capsuleAttachments.js';
import { callPdfParserExtract, type PdfParserClientConfig } from './pdfParserClient.js';
import { QuarantineStore } from './quarantine/index.js';
import { hasQuarantineKey } from './quarantine/index.js';
import type { DecryptedArtefact } from '../roles/depackagePipeline.js';

export interface ProcessPdfAttachmentsContext {
  mode: PdfParserMode;
  pdfParser: PdfParserClientConfig;
  messageId: string;
  envelopeSubject: string;
  envelopeFrom?: string;
  envelopeTo?: string;
  quarantineStore?: QuarantineStore;
}

export async function buildDepackagedAttachments(
  artefacts: DecryptedArtefact[],
  ctx: ProcessPdfAttachmentsContext,
): Promise<DepackagedAttachment[]> {
  const out: DepackagedAttachment[] = [];

  for (const art of artefacts) {
    const base: DepackagedAttachment = {
      id: art.id,
      filename: art.filename,
      content_type: art.contentType,
      size: art.size,
    };

    if (ctx.mode !== 'eager' || !isPdfContentType(art.contentType)) {
      out.push(base);
      continue;
    }

    const extract = await callPdfParserExtract(art.bytes, ctx.pdfParser);
    if (extract.ok) {
      out.push({
        ...base,
        extracted_text_v1: buildExtractedTextV1(extract.extracted_text, extract.structural_hash),
      });
      continue;
    }

    const reason = extract.reason;
    if (reason === 'extractor_unavailable') {
      out.push({ ...base, extraction_failed: { reason: 'extractor_unavailable' } });
      continue;
    }

    await quarantinePdfAttachment(art, ctx, reason);
    out.push({ ...base, extraction_failed: { reason } });
  }

  return out;
}

async function quarantinePdfAttachment(
  art: DecryptedArtefact,
  ctx: ProcessPdfAttachmentsContext,
  reason: string,
): Promise<void> {
  if (!hasQuarantineKey()) return;
  const store = ctx.quarantineStore ?? new QuarantineStore();
  const hash = createHash('sha256').update(art.bytes).digest('hex');
  try {
    await store.writeEntry({
      hash,
      rawBytes: art.bytes,
      envelopeFrom: ctx.envelopeFrom ?? '',
      envelopeTo: ctx.envelopeTo ?? '',
      envelopeDate: new Date().toISOString(),
      envelopeSubject: ctx.envelopeSubject,
      failedContainerRole: 'depackager',
      failedStage: `pdf_extract:${reason.slice(0, 120)}`,
    });
  } catch {
    // Quarantine is best-effort; depackage continues per attachment.
  }
}

export async function extractPdfOnDemand(
  pdfBytes: Buffer,
  pdfParser: PdfParserClientConfig,
): Promise<
  | { ok: true; extracted_text_v1: ReturnType<typeof buildExtractedTextV1> }
  | { ok: false; reason: string; reason_code?: string }
> {
  const result = await callPdfParserExtract(pdfBytes, pdfParser);
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      reason_code: result.reason_code,
    };
  }
  return {
    ok: true,
    extracted_text_v1: buildExtractedTextV1(result.extracted_text, result.structural_hash),
  };
}
