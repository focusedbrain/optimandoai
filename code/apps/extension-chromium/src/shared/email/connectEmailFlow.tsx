/**
 * Central launcher for the Connect Email modal (EmailConnectWizard).
 * Entry surfaces only call openConnectEmail(source) and render connectEmailFlowModal.
 *
 * Provider capability flags, mailbox/sync-target modeling, and credential storage are owned by the
 * Electron **main** process (`electron-vite-project/electron/main/email/domain/`). Keep provider
 * rules out of this file — UI launch only.
 *
 * UX-2b D2: topology-aware routing.
 *   - Host with linked sandbox (ingestionStatus.code === 'PAUSED_HOST_DELEGATED'):
 *       → EmailConnectWizard opens in 'host_send_only' mode (intro step + send scopes).
 *   - Sandbox node (ingestionStatus.thisNodeRole === 'sandbox'):
 *       → onOpenSandboxReadConsent() is called instead of opening EmailConnectWizard.
 *   - Single-machine / null status: unchanged.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { EmailConnectWizard } from '../components/EmailConnectWizard'
import { ConnectEmailLaunchSource } from './connectEmailTypes'
import type { IngestionTopologyStatus } from '../../wrguard/components/IngestionTopologyExplainer'

export { ConnectEmailLaunchSource, formatConnectEmailLaunchSource } from './connectEmailTypes'

/** Visual theme for the flow; maps to EmailConnectWizard's supported themes. */
export type ConnectEmailFlowTheme = 'professional' | 'default' | 'dark'

export interface UseConnectEmailFlowOptions {
  /** Called after a successful provider connection; reload accounts / sync UI here. */
  onAfterConnected: () => void | Promise<void>
  /** User closed the modal without completing a successful connection (X, backdrop, back-out). */
  onCancel?: (source: ConnectEmailLaunchSource | null) => void
  theme: ConnectEmailFlowTheme
  /**
   * UX-2b D2: current ingestion topology status from email:getIngestionStatus.
   * Null/omitted = single-machine or IPC not available → wizard unchanged.
   */
  ingestionStatus?: IngestionTopologyStatus | null
  /**
   * UX-2b D2: called when openConnectEmail() is triggered on a sandbox node.
   * Caller should open SandboxReadConsentWizard. When omitted, EmailConnectWizard
   * opens with default mode (fallback for contexts without the read-consent wizard).
   */
  onOpenSandboxReadConsent?: () => void
}

export function wizardThemeFromFlowTheme(flow: ConnectEmailFlowTheme): 'professional' | 'default' {
  if (flow === 'professional') return 'professional'
  // 'dark' and 'default' both use the wizard's non-professional (dark gradient) styling
  return 'default'
}

export interface UseConnectEmailFlowResult {
  /** Optional `reconnectAccountId` opens IMAP “update credentials” pre-filled for that account (Electron). */
  openConnectEmail: (source: ConnectEmailLaunchSource, options?: { reconnectAccountId?: string }) => void
  /** Render once near the root of the surface (same as previous EmailConnectWizard placement). */
  connectEmailFlowModal: React.ReactElement
}

/**
 * Single place for open/close/success/cancel coordination with EmailConnectWizard.
 * The wizard calls onConnected then onClose on success; we use a ref so onCancel does not run after success.
 */
export function useConnectEmailFlow(options: UseConnectEmailFlowOptions): UseConnectEmailFlowResult {
  const optsRef = useRef(options)
  optsRef.current = options

  const [isOpen, setIsOpen] = useState(false)
  const [launchSource, setLaunchSource] = useState<ConnectEmailLaunchSource | null>(null)
  const [reconnectAccountId, setReconnectAccountId] = useState<string | null>(null)
  const launchSourceRef = useRef<ConnectEmailLaunchSource | null>(null)
  useEffect(() => {
    launchSourceRef.current = launchSource
  }, [launchSource])

  const pendingSuccessRef = useRef(false)

  const openConnectEmail = useCallback((source: ConnectEmailLaunchSource, openOpts?: { reconnectAccountId?: string }) => {
    const { ingestionStatus, onOpenSandboxReadConsent } = optsRef.current

    // ── UX-2b D2: sandbox routing ─────────────────────────────────────────────
    // On sandbox nodes, route to the UX-1 read-consent wizard instead of the
    // full connect wizard (which would request all scopes — wrong on sandbox).
    if (ingestionStatus?.thisNodeRole === 'sandbox' && onOpenSandboxReadConsent) {
      console.info('[ConnectEmailFlow] sandbox node — routing to read-consent wizard', { source })
      onOpenSandboxReadConsent()
      return
    }
    // ─────────────────────────────────────────────────────────────────────────

    console.info('[ConnectEmailFlow] open', { source, reconnectAccountId: openOpts?.reconnectAccountId })
    setReconnectAccountId(openOpts?.reconnectAccountId?.trim() || null)
    setLaunchSource(source)
    setIsOpen(true)
  }, [])

  const handleConnected = useCallback(async (_account: { provider: string; email: string }) => {
    pendingSuccessRef.current = true
    try {
      await optsRef.current.onAfterConnected()
    } catch (e) {
      console.error('[ConnectEmailFlow] onAfterConnected failed:', e)
      pendingSuccessRef.current = false
    }
  }, [])

  const handleClose = useCallback(() => {
    const wasSuccess = pendingSuccessRef.current
    pendingSuccessRef.current = false
    const src = launchSourceRef.current
    setIsOpen(false)
    setLaunchSource(null)
    setReconnectAccountId(null)
    if (!wasSuccess) {
      if (src != null) {
        console.info('[ConnectEmailFlow] closed without successful connection', { source: src })
      }
      optsRef.current.onCancel?.(src)
    }
  }, [])

  const wizardTheme = wizardThemeFromFlowTheme(options.theme)

  // ── UX-2b D2: determine wizard mode from topology ──────────────────────────
  const wizardMode: 'default' | 'host_send_only' =
    options.ingestionStatus?.code === 'PAUSED_HOST_DELEGATED' &&
    options.ingestionStatus?.thisNodeRole === 'host'
      ? 'host_send_only'
      : 'default'
  // ──────────────────────────────────────────────────────────────────────────

  const connectEmailFlowModal = (
    <EmailConnectWizard
      isOpen={isOpen}
      onClose={handleClose}
      onConnected={handleConnected}
      theme={wizardTheme}
      launchSource={launchSource ?? undefined}
      reconnectAccountId={reconnectAccountId}
      wizardMode={wizardMode}
    />
  )

  return { openConnectEmail, connectEmailFlowModal }
}
