import { describe, expect, it, vi, beforeEach } from 'vitest'
import { resolvePdfParsingConsent } from '../pdfParsingConsentDecision.js'
import { grantSessionConsent, _clearAllSessionConsentForTests } from '../sessionConsent.js'
import { runInboxPdfExtractionWithConsent } from '../pdfParsingConsentFlow.js'

describe('Query with AI consent flow (integration)', () => {
  beforeEach(() => {
    _clearAllSessionConsentForTests()
    const inbox = {
      issuePdfExtractionConsent: vi.fn(async () => ({
        ok: true,
        data: { token: 'tok', expiresAt: new Date().toISOString() },
      })),
      requestPdfExtraction: vi.fn(async () => ({
        ok: true,
        data: { text: 'Extracted line', status: 'host_extracted_with_consent' },
      })),
    }
    vi.stubGlobal('window', { ...(globalThis as Window & typeof globalThis).window, emailInbox: inbox })
  })

  it('decision → dialog variant → extraction IPC for consent_required PDF', async () => {
    const decision = resolvePdfParsingConsent(
      {
        tier: 'free',
        modeResolverState: 'HostPodActive',
        edgeConfigurationState: 'not_configured',
        sessionConsentGranted: false,
      },
      { text_extraction_status: 'consent_required' },
    )
    expect(decision).toEqual({ kind: 'show_dialog', variant: 'VARIANT_FREE_TIER' })

    const result = await runInboxPdfExtractionWithConsent(
      {
        id: 'att-1',
        message_id: 'msg-1',
        filename: 'a.pdf',
        text_extraction_status: 'consent_required',
      },
      { grantSession: false },
    )
    expect(result.ok).toBe(true)
    expect(window.emailInbox?.issuePdfExtractionConsent).toHaveBeenCalledWith('msg-1', 'att-1')
    expect(window.emailInbox?.requestPdfExtraction).toHaveBeenCalled()
  })

  it('session consent skips dialog decision and still runs extraction when needed', async () => {
    grantSessionConsent('pdf_parsing')
    const decision = resolvePdfParsingConsent(
      {
        tier: 'free',
        modeResolverState: 'HostPodActive',
        edgeConfigurationState: 'not_configured',
        sessionConsentGranted: true,
      },
      { text_extraction_status: 'consent_required' },
    )
    expect(decision).toEqual({ kind: 'proceed' })

    await runInboxPdfExtractionWithConsent(
      {
        id: 'att-2',
        message_id: 'msg-2',
        text_extraction_status: 'consent_required',
      },
      { grantSession: true },
    )
    expect(window.emailInbox?.requestPdfExtraction).toHaveBeenCalled()
  })
})
