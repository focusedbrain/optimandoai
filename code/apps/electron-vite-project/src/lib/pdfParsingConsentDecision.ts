/**
 * PDF parsing consent decision tree (Workstream 4).
 */

import type { EdgeConfigurationState } from '../edge-tier/configurationState.js'
import type { IngestionModePublic } from '../components/IngestionModeStatusPill.js'

export type AccountTier = 'free' | 'paid'

export type PdfParsingConsentVariant =
  | 'VARIANT_FREE_TIER'
  | 'VARIANT_PAID_NO_EDGE'
  | 'VARIANT_EDGE_UNREACHABLE'
  | 'VARIANT_EDGE_INCOMPLETE'
  | 'VARIANT_PAID_EDGE_ACTIVE_UNEXPECTED'

export interface VerificationContext {
  tier: AccountTier
  modeResolverState: IngestionModePublic
  edgeConfigurationState: EdgeConfigurationState
  sessionConsentGranted: boolean
}

export interface ConsentAttachmentLike {
  text_extraction_status?: string | null
  content_type?: string | null
  filename?: string | null
}

export type PdfParsingConsentDecision =
  | { kind: 'proceed' }
  | { kind: 'show_dialog'; variant: PdfParsingConsentVariant }

const STATUSES_WITH_TEXT = new Set([
  'done',
  'partial',
  'edge_extracted',
  'host_extracted_with_consent',
])

export function attachmentNeedsPdfExtraction(att: ConsentAttachmentLike): boolean {
  const status = att.text_extraction_status ?? ''
  return status === 'consent_required' || status === 'pending'
}

export function attachmentHasReadableExtractedText(att: ConsentAttachmentLike): boolean {
  const status = att.text_extraction_status ?? ''
  return STATUSES_WITH_TEXT.has(status)
}

export function resolvePdfParsingConsent(
  ctx: VerificationContext,
  attachment: ConsentAttachmentLike,
): PdfParsingConsentDecision {
  const status = attachment.text_extraction_status ?? ''

  if (status === 'edge_extracted' || status === 'host_extracted_with_consent') {
    return { kind: 'proceed' }
  }

  if (status !== 'consent_required') {
    return { kind: 'proceed' }
  }

  if (ctx.sessionConsentGranted) {
    return { kind: 'proceed' }
  }

  if (ctx.tier === 'paid' && ctx.modeResolverState === 'EdgeActive') {
    console.warn(
      '[pdf-consent] paid tier with EdgeActive but attachment still consent_required — unexpected',
    )
    return { kind: 'show_dialog', variant: 'VARIANT_PAID_EDGE_ACTIVE_UNEXPECTED' }
  }

  if (ctx.tier === 'paid') {
    if (ctx.edgeConfigurationState === 'configured_unreachable') {
      return { kind: 'show_dialog', variant: 'VARIANT_EDGE_UNREACHABLE' }
    }
    if (ctx.edgeConfigurationState === 'setup_in_progress') {
      return { kind: 'show_dialog', variant: 'VARIANT_EDGE_INCOMPLETE' }
    }
    if (ctx.edgeConfigurationState === 'not_configured') {
      return { kind: 'show_dialog', variant: 'VARIANT_PAID_NO_EDGE' }
    }
    // Edge configured but this PDF was not server-extracted (host-route / fallback).
    return { kind: 'show_dialog', variant: 'VARIANT_FREE_TIER' }
  }

  return { kind: 'show_dialog', variant: 'VARIANT_FREE_TIER' }
}

/** @deprecated Use resolvePdfParsingConsent */
export function shouldShowConsentDialog(
  ctx: VerificationContext,
  attachment: ConsentAttachmentLike,
): PdfParsingConsentDecision {
  return resolvePdfParsingConsent(ctx, attachment)
}

export function edgeConfigurationFromIngestionSnapshot(raw: unknown): EdgeConfigurationState {
  const snap = raw as Record<string, unknown>
  const settings = snap.settings as Record<string, unknown> | undefined
  if (settings?.enabled === 'pending') return 'setup_in_progress'
  if (settings?.enabled === true) {
    return snap.mode === 'Blocked' ? 'configured_unreachable' : 'configured_active'
  }
  return 'not_configured'
}

export function modeFromIngestionSnapshot(raw: unknown): IngestionModePublic {
  const mode = (raw as Record<string, unknown>).mode
  if (
    mode === 'EdgeActive' ||
    mode === 'HostPodActive' ||
    mode === 'LegacyInProcess' ||
    mode === 'Blocked'
  ) {
    return mode
  }
  return 'HostPodActive'
}
