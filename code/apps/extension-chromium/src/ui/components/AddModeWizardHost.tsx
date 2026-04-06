/**
 * Listens for WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT and opens Add Mode in this window’s React tree
 * (sidebar, popup, or Electron dashboard) so the modal is scoped to the surface that triggered it.
 */

import React, { useEffect, useMemo, useState } from 'react'
import type { LightboxTheme } from '../../shared/ui/lightboxTheme'
import { useCustomModesStore } from '../../stores/useCustomModesStore'
import { useUIStore } from '../../stores/useUIStore'
import { getCustomModeScopeFromMetadata } from '../../shared/ui/customModeTypes'
import { syncCustomModeDiffWatcher } from '../../services/syncCustomModeDiffWatcher'
import { CustomModeWizard } from './CustomModeWizard'
import { WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT } from './wrMultiTrigger/WrMultiTriggerBar'

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

export function AddModeWizardHost({ theme }: AddModeWizardHostProps) {
  const [open, setOpen] = useState(false)
  const setWorkspace = useUIStore((s) => s.setWorkspace)
  const setMode = useUIStore((s) => s.setMode)
  const addMode = useCustomModesStore((s) => s.addMode)
  const lightboxTheme = useMemo(() => mapThemeToLightbox(theme), [theme])

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, onOpen)
    return () => window.removeEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, onOpen)
  }, [])

  return (
    <CustomModeWizard
      open={open}
      onClose={() => setOpen(false)}
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
    />
  )
}
