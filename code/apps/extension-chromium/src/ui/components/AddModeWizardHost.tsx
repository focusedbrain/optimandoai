/**
 * Listens for **`WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT`** (string defined in `WrMultiTriggerBar.tsx`)
 * and opens Add Automation in this window’s React tree (sidebar, popup, or Electron dashboard) so the modal
 * is scoped to the surface that triggered it. **Do not rename** the event constant’s value without
 * updating this listener and every `dispatchEvent` site.
 *
 * Flow: choice modal (Custom mode vs Project Assistant) → custom path mounts {@link CustomModeWizard}
 * unchanged; Project Assistant dispatches {@link WRDESK_OPEN_PROJECT_ASSISTANT_CREATION} for the desktop shell.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { LightboxTheme } from '../../shared/ui/lightboxTheme'
import { useCustomModesStore } from '../../stores/useCustomModesStore'
import { useUIStore } from '../../stores/useUIStore'
import { getCustomModeScopeFromMetadata } from '../../shared/ui/customModeTypes'
import { syncCustomModeDiffWatcher } from '../../services/syncCustomModeDiffWatcher'
import { CustomModeWizard } from './CustomModeWizard'
import { AddAutomationEntryModal } from './AddAutomationEntryModal'
import {
  WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT,
  WRCHAT_CUSTOM_MODE_WIZARD_SAVED,
  WRDESK_OPEN_PROJECT_ASSISTANT_CREATION,
} from './wrMultiTrigger/WrMultiTriggerBar'

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

function hasDesktopAnalysisBridge(): boolean {
  try {
    return typeof window !== 'undefined' && (window as unknown as { analysisDashboard?: unknown }).analysisDashboard != null
  } catch {
    return false
  }
}

type AutomationPhase = 'closed' | 'choose' | 'custom'

export function AddModeWizardHost({ theme }: AddModeWizardHostProps) {
  const [phase, setPhase] = useState<AutomationPhase>('closed')
  const setWorkspace = useUIStore((s) => s.setWorkspace)
  const setMode = useUIStore((s) => s.setMode)
  const addMode = useCustomModesStore((s) => s.addMode)
  const lightboxTheme = useMemo(() => mapThemeToLightbox(theme), [theme])
  const [showProjectAssistant, setShowProjectAssistant] = useState(() => hasDesktopAnalysisBridge())
  useEffect(() => {
    setShowProjectAssistant(hasDesktopAnalysisBridge())
  }, [])

  useEffect(() => {
    const onOpen = () => setPhase('choose')
    window.addEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, onOpen)
    return () => window.removeEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, onOpen)
  }, [])

  const handleCloseAll = useCallback(() => setPhase('closed'), [])

  const handleChooseCustomMode = useCallback(() => {
    setPhase('custom')
  }, [])

  const handleChooseProjectAssistant = useCallback(() => {
    setPhase('closed')
    try {
      window.dispatchEvent(new CustomEvent(WRDESK_OPEN_PROJECT_ASSISTANT_CREATION))
    } catch {
      /* noop */
    }
  }, [])

  const handleCustomSaved = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent(WRCHAT_CUSTOM_MODE_WIZARD_SAVED))
    } catch {
      /* noop */
    }
  }, [])

  return (
    <>
      <AddAutomationEntryModal
        open={phase === 'choose'}
        theme={lightboxTheme}
        onClose={handleCloseAll}
        onChooseCustomMode={handleChooseCustomMode}
        onChooseProjectAssistant={handleChooseProjectAssistant}
        showProjectAssistant={showProjectAssistant}
      />
      <CustomModeWizard
        open={phase === 'custom'}
        onClose={handleCloseAll}
        theme={lightboxTheme}
        onSave={(draft) => {
          const id = addMode(draft)
          const def = useCustomModesStore.getState().getById(id)
          if (def) {
            const scope = getCustomModeScopeFromMetadata(def.metadata as Record<string, unknown> | undefined)
            void syncCustomModeDiffWatcher(id, def.name, scope.diffWatchFolders)
          }
          setWorkspace('wr-chat')
          setMode(id)
        }}
        onSaved={handleCustomSaved}
      />
    </>
  )
}
