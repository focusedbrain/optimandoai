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
import type { LightboxTheme } from '../../shared/ui/lightboxTheme'
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

export function AddModeWizardHost({ theme }: AddModeWizardHostProps) {
  const [phase, setPhase] = useState<AutomationPhase>('closed')
  const setWorkspace = useUIStore((s) => s.setWorkspace)
  const setMode = useUIStore((s) => s.setMode)
  const addMode = useCustomModesStore((s) => s.addMode)
  const lightboxTheme = useMemo(() => mapThemeToLightbox(theme), [theme])

  useEffect(() => {
    const onOpen = () => setPhase('custom')
    window.addEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, onOpen)
    return () => window.removeEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, onOpen)
  }, [])

  const handleCloseAll = useCallback(() => setPhase('closed'), [])

  const handleCustomSaved = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent(WRCHAT_CUSTOM_MODE_WIZARD_SAVED))
    } catch {
      /* noop */
    }
  }, [])

  return (
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
  )
}
