/**
 * Product copy and view model for Sandbox clone feedback (Standard theme, WCAG-oriented).
 */
import {
  SANDBOX_IDENTITY_INCOMPLETE_USER_MESSAGE,
  SANDBOX_KEYING_INCOMPLETE_USER_MESSAGE,
} from './beapInboxHostSandboxClickPolicy'

export const SANDBOX_CLONE_COPY = {
  successLive: 'Message cloned and sent to Sandbox.',
  successQueued:
    'Message cloned and queued for Sandbox. It will arrive when the Sandbox orchestrator reconnects.',
  noOrchestrator:
    'No active Sandbox orchestrator connected. Connect a Sandbox orchestrator under the same identity to clone messages safely.',
  failedGeneric: 'Sandbox clone failed. Please try again.',
  cloning: 'Cloning message to Sandbox…',
  checking: 'Checking internal Sandbox handshakes…',
} as const

export type SandboxCloneFeedbackVariant = 'success' | 'queued' | 'info' | 'error' | 'loading' | 'warning'

/**
 * - persistUntilDismiss: show dismiss control; do not auto-hide (error, long info).
 * - When false, parent should clear after ~5.5s (success/queued/loading) or 8s (warning).
 */
export type SandboxCloneFeedbackView = {
  variant: SandboxCloneFeedbackVariant
  message: string
  persistUntilDismiss: boolean
  /** Shown in aria-label / title for support; not the main badge line. */
  screenReaderDetail?: string
}

export function viewSandboxKeyingIncomplete(): SandboxCloneFeedbackView {
  return {
    variant: 'warning',
    message: SANDBOX_KEYING_INCOMPLETE_USER_MESSAGE,
    persistUntilDismiss: false,
  }
}

export function viewSandboxIdentityIncomplete(): SandboxCloneFeedbackView {
  return {
    variant: 'info',
    message: SANDBOX_IDENTITY_INCOMPLETE_USER_MESSAGE,
    persistUntilDismiss: false,
  }
}

export function viewSandboxChecking(): SandboxCloneFeedbackView {
  return {
    variant: 'loading',
    message: SANDBOX_CLONE_COPY.checking,
    persistUntilDismiss: false,
  }
}

export function viewSandboxCloning(): SandboxCloneFeedbackView {
  return {
    variant: 'loading',
    message: SANDBOX_CLONE_COPY.cloning,
    persistUntilDismiss: false,
  }
}

export function viewSandboxNoOrchestrator(): SandboxCloneFeedbackView {
  return {
    variant: 'info',
    message: SANDBOX_CLONE_COPY.noOrchestrator,
    persistUntilDismiss: true,
  }
}

export function viewSandboxListLoadFailed(detail: string | null | undefined): SandboxCloneFeedbackView {
  const d = (detail && String(detail).trim()) || 'Unknown error'
  return {
    variant: 'error',
    message: 'Could not load Sandbox handshakes. Check your connection and try again.',
    persistUntilDismiss: true,
    screenReaderDetail: d,
  }
}
