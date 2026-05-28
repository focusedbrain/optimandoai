/**
 * Audit log for consent-gated PDF extraction on the host.
 */

import { getCurrentIngestionMode } from '../ingestion/ingestionModeService.js'
import { loadEdgeTierSettings, isEdgeTierActiveForRouting } from '../edge-tier/settings.js'

export interface PdfConsentExtractionAuditEvent {
  messageId: string
  attachmentId: string
  consentTokenHash: string
  consentedAt: string
  result: 'success' | 'failure'
  reason?: string
  ingestionMode?: string
  edgeTierActive?: boolean
  textExtractionStatus?: string
}

export async function logPdfConsentExtraction(
  event: Omit<PdfConsentExtractionAuditEvent, 'ingestionMode' | 'edgeTierActive'> &
    Partial<Pick<PdfConsentExtractionAuditEvent, 'ingestionMode' | 'edgeTierActive'>>,
): Promise<void> {
  let ingestionMode = event.ingestionMode
  let edgeTierActive = event.edgeTierActive
  if (ingestionMode === undefined || edgeTierActive === undefined) {
    try {
      const snap = await getCurrentIngestionMode()
      ingestionMode = snap.mode
      edgeTierActive = isEdgeTierActiveForRouting(loadEdgeTierSettings())
    } catch {
      ingestionMode = ingestionMode ?? 'unknown'
      edgeTierActive = edgeTierActive ?? false
    }
  }
  const line = {
    type: 'pdf_consent_extraction',
    timestamp: new Date().toISOString(),
    ...event,
    ingestionMode,
    edgeTierActive,
  }
  console.log(JSON.stringify(line))
}
