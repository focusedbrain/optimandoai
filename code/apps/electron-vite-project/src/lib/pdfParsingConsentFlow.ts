/**
 * Host inbox PDF extraction after consent (renderer orchestration).
 */

import { grantSessionConsent } from './sessionConsent.js'
import type { ConsentAttachmentLike } from './pdfParsingConsentDecision.js'
import { attachmentNeedsPdfExtraction } from './pdfParsingConsentDecision.js'

export interface InboxPdfAttachmentTarget extends ConsentAttachmentLike {
  id: string
  message_id: string
  filename?: string | null
}

export type PdfExtractionFlowResult =
  | { ok: true; status: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: string }

export async function runInboxPdfExtractionWithConsent(
  target: InboxPdfAttachmentTarget,
  opts: { grantSession?: boolean },
): Promise<PdfExtractionFlowResult> {
  const inbox = window.emailInbox
  if (!inbox?.issuePdfExtractionConsent || !inbox?.requestPdfExtraction) {
    return { ok: false, cancelled: false, error: 'PDF extraction is not available in this build.' }
  }

  if (!attachmentNeedsPdfExtraction(target)) {
    return { ok: true, status: target.text_extraction_status ?? 'done' }
  }

  if (opts.grantSession) {
    grantSessionConsent('pdf_parsing')
  }

  const issued = await inbox.issuePdfExtractionConsent(target.message_id, target.id)
  if (!issued.ok || !issued.data?.token) {
    return { ok: false, cancelled: false, error: issued.error ?? 'Could not issue consent token' }
  }

  const extracted = await inbox.requestPdfExtraction({
    messageId: target.message_id,
    attachmentId: target.id,
    consentSignature: issued.data.token,
  })

  if (!extracted.ok) {
    return { ok: false, cancelled: false, error: extracted.error ?? 'Extraction failed' }
  }

  return { ok: true, status: extracted.data?.status ?? 'host_extracted_with_consent' }
}

/** Chat / composer PDF bytes — dialog already shown; runs main-process extract via preload. */
export async function runChatPdfExtractAfterConsent(opts: {
  filename: string
  base64: string
  grantSession?: boolean
}): Promise<{ text: string; error?: string }> {
  if (opts.grantSession) {
    grantSessionConsent('pdf_parsing')
  }

  const beap = window.beap
  if (typeof beap?.extractPdfText !== 'function') {
    return { text: '', error: 'PDF extract is only available inside the WR Desk app.' }
  }

  const ipc = await beap.extractPdfText({
    attachmentId: `chat-consent-${Date.now()}`,
    base64: opts.base64,
  })

  if (ipc?.success && typeof ipc.extractedText === 'string' && ipc.extractedText.trim()) {
    return { text: ipc.extractedText.trim() }
  }

  return {
    text: '',
    error: ipc?.error ?? 'Could not extract text from this PDF.',
  }
}

export function openEdgeVerificationSetup(): void {
  window.dispatchEvent(new CustomEvent('wrdesk:expand-email-accounts-section'))
}

export async function waitForEdgeReachability(): Promise<boolean> {
  try {
    await window.ingestionMode?.retryEdge?.()
    const snap = await window.ingestionMode?.get?.()
    const mode = (snap as { mode?: string } | null)?.mode
    return mode === 'EdgeActive'
  } catch {
    return false
  }
}
