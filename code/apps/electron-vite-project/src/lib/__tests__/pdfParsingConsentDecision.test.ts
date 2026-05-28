import { describe, expect, it, vi } from 'vitest'
import {
  resolvePdfParsingConsent,
  type VerificationContext,
} from '../pdfParsingConsentDecision.js'
import { grantSessionConsent, _clearAllSessionConsentForTests } from '../sessionConsent.js'

const baseCtx = (overrides: Partial<VerificationContext> = {}): VerificationContext => ({
  tier: 'free',
  modeResolverState: 'HostPodActive',
  edgeConfigurationState: 'not_configured',
  sessionConsentGranted: false,
  ...overrides,
})

describe('resolvePdfParsingConsent', () => {
  it('proceeds for edge_extracted', () => {
    expect(
      resolvePdfParsingConsent(baseCtx(), { text_extraction_status: 'edge_extracted' }),
    ).toEqual({ kind: 'proceed' })
  })

  it('proceeds for host_extracted_with_consent', () => {
    expect(
      resolvePdfParsingConsent(baseCtx(), {
        text_extraction_status: 'host_extracted_with_consent',
      }),
    ).toEqual({ kind: 'proceed' })
  })

  it('proceeds for non-PDF / non-consent statuses', () => {
    expect(resolvePdfParsingConsent(baseCtx(), { text_extraction_status: 'done' })).toEqual({
      kind: 'proceed',
    })
    expect(resolvePdfParsingConsent(baseCtx(), { text_extraction_status: 'skipped' })).toEqual({
      kind: 'proceed',
    })
  })

  it('proceeds when session pdf_parsing consent granted', () => {
    grantSessionConsent('pdf_parsing')
    expect(
      resolvePdfParsingConsent(baseCtx({ sessionConsentGranted: true }), {
        text_extraction_status: 'consent_required',
      }),
    ).toEqual({ kind: 'proceed' })
    _clearAllSessionConsentForTests()
  })

  it('VARIANT_FREE_TIER for free tier + consent_required', () => {
    expect(
      resolvePdfParsingConsent(baseCtx(), { text_extraction_status: 'consent_required' }),
    ).toEqual({ kind: 'show_dialog', variant: 'VARIANT_FREE_TIER' })
  })

  it('VARIANT_PAID_NO_EDGE when paid and edge not configured', () => {
    expect(
      resolvePdfParsingConsent(baseCtx({ tier: 'paid' }), {
        text_extraction_status: 'consent_required',
      }),
    ).toEqual({ kind: 'show_dialog', variant: 'VARIANT_PAID_NO_EDGE' })
  })

  it('VARIANT_EDGE_UNREACHABLE when paid and edge unreachable', () => {
    expect(
      resolvePdfParsingConsent(
        baseCtx({ tier: 'paid', edgeConfigurationState: 'configured_unreachable' }),
        { text_extraction_status: 'consent_required' },
      ),
    ).toEqual({ kind: 'show_dialog', variant: 'VARIANT_EDGE_UNREACHABLE' })
  })

  it('VARIANT_EDGE_INCOMPLETE when paid and setup in progress', () => {
    expect(
      resolvePdfParsingConsent(
        baseCtx({ tier: 'paid', edgeConfigurationState: 'setup_in_progress' }),
        { text_extraction_status: 'consent_required' },
      ),
    ).toEqual({ kind: 'show_dialog', variant: 'VARIANT_EDGE_INCOMPLETE' })
  })

  it('VARIANT_PAID_EDGE_ACTIVE_UNEXPECTED when paid + EdgeActive + consent_required', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      resolvePdfParsingConsent(
        baseCtx({ tier: 'paid', modeResolverState: 'EdgeActive', edgeConfigurationState: 'configured_active' }),
        { text_extraction_status: 'consent_required' },
      ),
    ).toEqual({ kind: 'show_dialog', variant: 'VARIANT_PAID_EDGE_ACTIVE_UNEXPECTED' })
    warn.mockRestore()
  })
})
