import { describe, expect, it } from 'vitest'
import { resolvePdfParsingConsent, type VerificationContext } from '../pdfParsingConsentDecision.js'

describe('pdf consent decision transitions', () => {
  const att = { text_extraction_status: 'consent_required' as const }

  it('variant changes when edge moves from unreachable to active (still consent_required)', () => {
    const unreachable: VerificationContext = {
      tier: 'paid',
      modeResolverState: 'Blocked',
      edgeConfigurationState: 'configured_unreachable',
      sessionConsentGranted: false,
    }
    const active: VerificationContext = {
      tier: 'paid',
      modeResolverState: 'EdgeActive',
      edgeConfigurationState: 'configured_active',
      sessionConsentGranted: false,
    }
    expect(resolvePdfParsingConsent(unreachable, att)).toEqual({
      kind: 'show_dialog',
      variant: 'VARIANT_EDGE_UNREACHABLE',
    })
    expect(resolvePdfParsingConsent(active, att)).toEqual({
      kind: 'show_dialog',
      variant: 'VARIANT_PAID_EDGE_ACTIVE_UNEXPECTED',
    })
  })

  it('session consent persists across mode changes', () => {
    const withSession: VerificationContext = {
      tier: 'paid',
      modeResolverState: 'Blocked',
      edgeConfigurationState: 'configured_unreachable',
      sessionConsentGranted: true,
    }
    const afterEdgeActive: VerificationContext = {
      ...withSession,
      modeResolverState: 'EdgeActive',
      edgeConfigurationState: 'configured_active',
    }
    expect(resolvePdfParsingConsent(withSession, att)).toEqual({ kind: 'proceed' })
    expect(resolvePdfParsingConsent(afterEdgeActive, att)).toEqual({ kind: 'proceed' })
  })

  it('extracted text status is not invalidated when edge comes back', () => {
    const extracted = { text_extraction_status: 'host_extracted_with_consent' as const }
    expect(
      resolvePdfParsingConsent(
        {
          tier: 'paid',
          modeResolverState: 'EdgeActive',
          edgeConfigurationState: 'configured_active',
          sessionConsentGranted: false,
        },
        extracted,
      ),
    ).toEqual({ kind: 'proceed' })
  })
})
