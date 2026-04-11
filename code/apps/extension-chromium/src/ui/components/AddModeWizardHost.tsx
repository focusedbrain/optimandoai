/**
 * Listens for **`WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT`** (see `WrMultiTriggerBar.tsx`)
 * and mounts {@link CustomModeWizard} in this window’s React tree (sidebar, popup, or Electron dashboard).
 *
 * **Two creation entry points** (trigger bar dropdown):
 * - **+ Add Automation** → this event → **custom mode wizard only** (`useCustomModesStore` / `CustomModeDraft`).
 * - **+ Add Project WIKI** → `WRDESK_OPEN_PROJECT_ASSISTANT_CREATION` (handled in `App.tsx` / desktop Analysis;
 *   not wired through this host so Project WIKI never goes through CustomModeDraft).
 *
 * **Do not rename** `WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT` without updating every `dispatchEvent` site.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import type { LightboxTheme } from '../../shared/ui/lightboxTheme'
import type { CustomModeDefinition } from '../../shared/ui/customModeTypes'
import { useCustomModesStore } from '../../stores/useCustomModesStore'
import { useUIStore } from '../../stores/useUIStore'
import { getCustomModeScopeFromMetadata } from '../../shared/ui/customModeTypes'
import { syncCustomModeDiffWatcher } from '../../services/syncCustomModeDiffWatcher'
import { CustomModeWizard } from './CustomModeWizard'
import { WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, WRCHAT_CUSTOM_MODE_WIZARD_SAVED } from './wrMultiTrigger/WrMultiTriggerBar'

export interface AddModeWizardHostProps {
  /** Extension: 'pro' | 'dark' | 'standard'. ModeSelect: 'default' | 'dark' | 'professional'. */
  theme?: string
}

/**
 * Align with `getThemeTokens` in lightboxTheme.ts:
 * - `pro` / `default` → purple Pro (PRO_TOKENS)
 * - `standard` / `professional` → light Standard (STANDARD_TOKENS)
 * - `dark` → DARK_TOKENS
 */
function mapThemeToLightbox(theme: string | undefined): LightboxTheme {
  const t = (theme ?? 'default').toLowerCase()
  if (t === 'dark') return 'dark'
  if (t === 'pro') return 'default'
  if (t === 'standard') return 'professional'
  if (t === 'professional') return 'professional'
  if (t === 'default') return 'default'
  return 'default'
}

type AutomationPhase = 'closed' | 'custom'

type WizardErrorBoundaryProps = { children: ReactNode; onReset: () => void }

type WizardErrorBoundaryState = { hasError: boolean }

class AddModeWizardErrorBoundary extends React.Component<
  WizardErrorBoundaryProps,
  WizardErrorBoundaryState
> {
  constructor(props: WizardErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): WizardErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AddModeWizardHost] wizard render error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100000,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              maxWidth: 420,
              width: '100%',
              background: '#f8fafc',
              color: '#0f172a',
              borderRadius: 12,
              padding: '24px 20px',
              textAlign: 'center',
              fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
              boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Something went wrong</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.45, color: '#475569' }}>
              The automation wizard encountered an error. You can close this dialog and try again.
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false })
                this.props.onReset()
              }}
              style={{
                padding: '10px 18px',
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                background: '#4f46e5',
                color: '#fff',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export function AddModeWizardHost({ theme }: AddModeWizardHostProps) {
  const [phase, setPhase] = useState<AutomationPhase>('closed')
  const [editTarget, setEditTarget] = useState<CustomModeDefinition | null>(null)
  const setWorkspace = useUIStore((s) => s.setWorkspace)
  const setMode = useUIStore((s) => s.setMode)
  const addMode = useCustomModesStore((s) => s.addMode)
  const updateMode = useCustomModesStore((s) => s.updateMode)
  const lightboxTheme = useMemo(() => mapThemeToLightbox(theme), [theme])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ editModeId?: string }>).detail
      if (detail?.editModeId) {
        const existing = useCustomModesStore.getState().getById(detail.editModeId)
        if (existing) {
          setEditTarget(existing)
          setPhase('custom')
        } else {
          console.warn('[AddModeWizardHost] Mode not found for edit:', detail.editModeId)
        }
      } else {
        setEditTarget(null)
        setPhase('custom')
      }
    }
    window.addEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, onOpen)
    return () => window.removeEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, onOpen)
  }, [])

  const handleCloseAll = useCallback(() => {
    setPhase('closed')
    setEditTarget(null)
  }, [])

  const handleCustomSaved = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent(WRCHAT_CUSTOM_MODE_WIZARD_SAVED))
    } catch {
      /* noop */
    }
  }, [])

  const wizardBoundaryKey = phase === 'custom' ? `custom-${editTarget?.id ?? 'new'}` : 'closed'

  return (
    <AddModeWizardErrorBoundary key={wizardBoundaryKey} onReset={handleCloseAll}>
      <CustomModeWizard
        open={phase === 'custom'}
        editTarget={editTarget}
        onClose={handleCloseAll}
        theme={lightboxTheme}
        onSave={(draft) => {
          if (editTarget) {
            updateMode(editTarget.id, draft)
            const def = useCustomModesStore.getState().getById(editTarget.id)
            if (def) {
              const scope = getCustomModeScopeFromMetadata(def.metadata as Record<string, unknown> | undefined)
              void syncCustomModeDiffWatcher(editTarget.id, def.name, scope.diffWatchFolders)
            }
          } else {
            const id = addMode(draft)
            const def = useCustomModesStore.getState().getById(id)
            if (def) {
              const scope = getCustomModeScopeFromMetadata(def.metadata as Record<string, unknown> | undefined)
              void syncCustomModeDiffWatcher(id, def.name, scope.diffWatchFolders)
            }
            setWorkspace('wr-chat')
            setMode(id)
          }
        }}
        onSaved={handleCustomSaved}
      />
    </AddModeWizardErrorBoundary>
  )
}
