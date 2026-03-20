/**
 * Central launcher for the Connect Email modal (EmailConnectWizard).
 * Entry surfaces only call openConnectEmail(source) and render connectEmailFlowModal.
 *
 * Provider capability flags, mailbox/sync-target modeling, and credential storage are owned by the
 * Electron **main** process (`electron-vite-project/electron/main/email/domain/`). Keep provider
 * rules out of this file — UI launch only.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { EmailConnectWizard } from '../components/EmailConnectWizard'
import { ConnectEmailLaunchSource } from './connectEmailTypes'

export { ConnectEmailLaunchSource, formatConnectEmailLaunchSource } from './connectEmailTypes'

/** Visual theme for the flow; maps to EmailConnectWizard's supported themes. */
export type ConnectEmailFlowTheme = 'professional' | 'default' | 'dark'

export interface UseConnectEmailFlowOptions {
  /** Called after a successful provider connection; reload accounts / sync UI here. */
  onAfterConnected: () => void | Promise<void>
  /** User closed the modal without completing a successful connection (X, backdrop, back-out). */
  onCancel?: (source: ConnectEmailLaunchSource | null) => void
  theme: ConnectEmailFlowTheme
}

export function wizardThemeFromFlowTheme(flow: ConnectEmailFlowTheme): 'professional' | 'default' {
  if (flow === 'professional') return 'professional'
  // 'dark' and 'default' both use the wizard's non-professional (dark gradient) styling
  return 'default'
}

export interface UseConnectEmailFlowResult {
  openConnectEmail: (source: ConnectEmailLaunchSource) => void
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
  const launchSourceRef = useRef<ConnectEmailLaunchSource | null>(null)
  useEffect(() => {
    launchSourceRef.current = launchSource
  }, [launchSource])

  const pendingSuccessRef = useRef(false)

  const openConnectEmail = useCallback((source: ConnectEmailLaunchSource) => {
    console.info('[ConnectEmailFlow] open', { source })
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
    if (!wasSuccess) {
      if (src != null) {
        console.info('[ConnectEmailFlow] closed without successful connection', { source: src })
      }
      optsRef.current.onCancel?.(src)
    }
  }, [])

  const wizardTheme = wizardThemeFromFlowTheme(options.theme)

  const connectEmailFlowModal = (
    <EmailConnectWizard
      isOpen={isOpen}
      onClose={handleClose}
      onConnected={handleConnected}
      theme={wizardTheme}
      launchSource={launchSource ?? undefined}
    />
  )

  return { openConnectEmail, connectEmailFlowModal }
}
