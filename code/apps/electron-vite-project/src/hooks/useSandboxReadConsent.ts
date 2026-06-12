/**
 * UX-1 D5 — useSandboxReadConsent
 *
 * Returns { showWizard, openWizard, closeWizard } where `showWizard` is true
 * when the wizard should be open.
 *
 * The caller (EmailInboxView / IngestionStatusBanner CTA) decides when to call
 * openWizard. This hook just manages the open/close state and provides a
 * convenience `shouldShowPrompt` signal derived from the ingestion status so
 * callers can auto-open if desired.
 *
 * shouldShowPrompt: true when
 *   - status.code === 'ACTION_NEEDED_READ_CONSENT'
 *   - status.thisNodeRole === 'sandbox'   (this node IS the sandbox owner)
 *
 * Single-machine suppression: useIngestionStatus already returns null for
 * host-only topologies, so status will never reach this hook with
 * ACTION_NEEDED_READ_CONSENT on a single-machine host.
 */

import { useCallback, useState } from 'react'
import type { IngestionStatusResult } from '../../electron/main/email/ingestionStatus'

export interface UseSandboxReadConsentResult {
  showWizard: boolean
  /** True when action is needed and this node is the sandbox — caller can auto-open. */
  shouldShowPrompt: boolean
  openWizard: () => void
  closeWizard: () => void
}

export function useSandboxReadConsent(
  status: IngestionStatusResult | null,
): UseSandboxReadConsentResult {
  const [showWizard, setShowWizard] = useState(false)

  const shouldShowPrompt =
    status?.code === 'ACTION_NEEDED_READ_CONSENT' && status?.thisNodeRole === 'sandbox'

  const openWizard = useCallback(() => setShowWizard(true), [])
  const closeWizard = useCallback(() => setShowWizard(false), [])

  return { showWizard, shouldShowPrompt, openWizard, closeWizard }
}
