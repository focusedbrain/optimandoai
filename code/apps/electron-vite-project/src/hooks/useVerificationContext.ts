/**
 * Single source of truth for PDF consent dialog decisions (tier, mode, edge config, session consent).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EdgeConfigurationState } from '../edge-tier/configurationState.js'
import type { IngestionModePublic } from '../components/IngestionModeStatusPill.js'
import {
  edgeConfigurationFromIngestionSnapshot,
  modeFromIngestionSnapshot,
  type AccountTier,
  type VerificationContext,
} from '../lib/pdfParsingConsentDecision.js'
import { hasSessionConsent, onSessionConsentChange } from '../lib/sessionConsent.js'

export type { VerificationContext, AccountTier }

export function useVerificationContext(): VerificationContext & { refresh: () => void } {
  const [tier, setTier] = useState<AccountTier>('free')
  const [modeResolverState, setModeResolverState] = useState<IngestionModePublic>('HostPodActive')
  const [edgeConfigurationState, setEdgeConfigurationState] =
    useState<EdgeConfigurationState>('not_configured')
  const [sessionConsentGranted, setSessionConsentGranted] = useState(() =>
    hasSessionConsent('pdf_parsing'),
  )

  const applyIngestionSnapshot = useCallback((raw: unknown) => {
    setModeResolverState(modeFromIngestionSnapshot(raw))
    setEdgeConfigurationState(edgeConfigurationFromIngestionSnapshot(raw))
  }, [])

  const refresh = useCallback(async () => {
    try {
      if (window.verificationContext?.getSnapshot) {
        const snap = await window.verificationContext.getSnapshot()
        setTier(snap.tier)
        setModeResolverState(
          snap.modeResolverState as IngestionModePublic,
        )
        setEdgeConfigurationState(snap.edgeConfigurationState)
      } else {
        const tierRes = await window.wizard?.refreshTier?.()
        if (tierRes) {
          setTier(tierRes.isPaidTier ? 'paid' : 'free')
        }
        const modeSnap = await window.ingestionMode?.get?.()
        if (modeSnap) applyIngestionSnapshot(modeSnap)
      }
    } catch {
      /* keep last snapshot */
    }

    setSessionConsentGranted(hasSessionConsent('pdf_parsing'))
  }, [applyIngestionSnapshot])

  useEffect(() => {
    void refresh()
    const offVc = window.verificationContext?.onUpdated?.(() => {
      void refresh()
    })
    const offMode = window.ingestionMode?.onUpdated?.((snap) => {
      applyIngestionSnapshot(snap)
    })
    const offDash = window.dashboard?.onUpdates?.((payload) => {
      if (payload && typeof payload === 'object' && 'edge_configuration_state' in payload) {
        const state = (payload as { edge_configuration_state?: string }).edge_configuration_state
        if (
          state === 'not_configured' ||
          state === 'setup_in_progress' ||
          state === 'configured_active' ||
          state === 'configured_unreachable'
        ) {
          setEdgeConfigurationState(state)
        }
      }
    })
    const offConsent = onSessionConsentChange(() => {
      setSessionConsentGranted(hasSessionConsent('pdf_parsing'))
    })
    return () => {
      offVc?.()
      offMode?.()
      offDash?.()
      offConsent()
    }
  }, [refresh, applyIngestionSnapshot])

  const value = useMemo(
    (): VerificationContext => ({
      tier,
      modeResolverState,
      edgeConfigurationState,
      sessionConsentGranted,
    }),
    [tier, modeResolverState, edgeConfigurationState, sessionConsentGranted],
  )

  return { ...value, refresh }
}
