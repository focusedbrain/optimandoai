/**
 * Core implementation for inbox:requestPdfExtraction (testable without full IPC registration).
 */

import fs from 'fs'
import { createHash } from 'crypto'
import {
  issuePdfExtractionConsentToken,
  verifyPdfExtractionConsentToken,
  hashConsentTokenForAudit,
} from './pdfConsentToken.js'
import { extractPdfTextViaPod, isPdfFile, resolveInboxPdfExtractionStatus } from './pdf-extractor.js'
import { verifyExtractedTextStructuralHash } from './pdfStructuralHash.js'
import { resealWithPdfExtraction } from './sealedContentUpdate.js'
import { logPdfConsentExtraction } from './pdfExtractionAudit.js'
import { readDecryptedAttachmentBuffer } from './attachmentBlobCrypto.js'

function inboxPagesFromStoredExtractedText(text: string): string[] {
  const t = typeof text === 'string' ? text : ''
  const trimmed = t.trim()
  if (!trimmed) return []
  const parts = t.split(/\n\n+/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [trimmed]
}

export interface InboxPdfExtractionRequestPayload {
  messageId?: string
  attachmentId?: string
  consentSignature?: string
}

export type InboxPdfExtractionRequestResult =
  | {
      ok: true
      data: {
        text: string
        pages: string[]
        status: string
        error: string | null
        content_sha256: string
        extracted_text_sha256: string
      }
    }
  | { ok: false; error: string; code?: string }

export function issueInboxPdfExtractionConsent(
  messageId: string,
  attachmentId: string,
): { ok: true; data: ReturnType<typeof issuePdfExtractionConsentToken> } | { ok: false; error: string } {
  if (!messageId || !attachmentId) {
    return { ok: false, error: 'Missing messageId or attachmentId' }
  }
  return { ok: true, data: issuePdfExtractionConsentToken(messageId, attachmentId) }
}

export async function executeInboxRequestPdfExtraction(
  db: any,
  payload: InboxPdfExtractionRequestPayload,
): Promise<InboxPdfExtractionRequestResult> {
  const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : ''
  const attachmentId =
    typeof payload?.attachmentId === 'string' ? payload.attachmentId.trim() : ''
  const consentSignature =
    typeof payload?.consentSignature === 'string' ? payload.consentSignature.trim() : ''

  if (!messageId || !attachmentId || !consentSignature) {
    return { ok: false, error: 'Missing messageId, attachmentId, or consentSignature' }
  }

  if (!verifyPdfExtractionConsentToken(consentSignature, messageId, attachmentId)) {
    return { ok: false, error: 'Invalid or expired consent token', code: 'CONSENT_INVALID' }
  }

  const consentedAt = new Date().toISOString()
  const consentTokenHash = hashConsentTokenForAudit(consentSignature)

  try {
    const row = db
      .prepare('SELECT * FROM inbox_attachments WHERE id = ? AND message_id = ?')
      .get(attachmentId, messageId) as Record<string, unknown> | undefined
    if (!row) return { ok: false, error: 'Attachment not found' }

    if (!isPdfFile(String(row.content_type ?? ''), String(row.filename ?? ''))) {
      return { ok: false, error: 'Not a PDF attachment' }
    }

    if (!row.storage_path || typeof row.storage_path !== 'string' || !fs.existsSync(row.storage_path)) {
      return { ok: false, error: 'Attachment file not found' }
    }

    let buf: Buffer
    try {
      buf = readDecryptedAttachmentBuffer(row as Parameters<typeof readDecryptedAttachmentBuffer>[0])
    } catch (decErr: unknown) {
      return {
        ok: false,
        error: decErr instanceof Error ? decErr.message : 'Could not read attachment',
      }
    }

    const result = await extractPdfTextViaPod(buf, messageId, attachmentId)
    const text = result.text ?? ''

    if (
      result.structural_hash &&
      text &&
      !verifyExtractedTextStructuralHash(text, result.structural_hash)
    ) {
      await logPdfConsentExtraction({
        messageId,
        attachmentId,
        consentTokenHash,
        consentedAt,
        result: 'failure',
        reason: 'structural_hash_mismatch',
      })
      return { ok: false, error: 'Extraction hash verification failed', code: 'HASH_MISMATCH' }
    }

    const resolved = resolveInboxPdfExtractionStatus(result)
    const status = resolved.status === 'done' ? 'host_extracted_with_consent' : resolved.status

    const contentSha256 = createHash('sha256').update(buf).digest('hex')
    const extractedTextSha256 = createHash('sha256').update(text, 'utf8').digest('hex')
    const pageCount =
      typeof result.pageCount === 'number' && result.pageCount > 0 ? result.pageCount : null

    const sealResult = await resealWithPdfExtraction(db, attachmentId, {
      text,
      status,
      error: resolved.error,
      contentSha256,
      extractedTextSha256,
      pageCount,
      consentTokenHash,
      consentedAt,
      structuralHash: result.structural_hash ?? null,
      extractorVersion: result.extractor_version ?? null,
    })

    if (!sealResult.ok) {
      await logPdfConsentExtraction({
        messageId,
        attachmentId,
        consentTokenHash,
        consentedAt,
        result: 'failure',
        reason: sealResult.error,
      })
      return {
        ok: false,
        error: `PDF text extraction could not be persisted: ${sealResult.error}`,
      }
    }

    await logPdfConsentExtraction({
      messageId,
      attachmentId,
      consentTokenHash,
      consentedAt,
      result: 'success',
      textExtractionStatus: status,
    })

    const pagesOut =
      Array.isArray(result.pages) && result.pages.length > 0
        ? result.pages
        : inboxPagesFromStoredExtractedText(text)

    return {
      ok: true,
      data: {
        text,
        pages: pagesOut,
        status,
        error: resolved.error,
        content_sha256: contentSha256,
        extracted_text_sha256: extractedTextSha256,
      },
    }
  } catch (err: unknown) {
    await logPdfConsentExtraction({
      messageId,
      attachmentId,
      consentTokenHash,
      consentedAt,
      result: 'failure',
      reason: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, error: err instanceof Error ? err.message : 'Extraction failed' }
  }
}
