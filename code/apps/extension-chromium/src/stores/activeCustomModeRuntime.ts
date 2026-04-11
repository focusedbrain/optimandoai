/**
 * Resolves the active custom mode (if any) from UI mode id + persisted custom modes.
 */

import { useMemo } from 'react'
import { useUIStore } from './useUIStore'
import { useCustomModesStore } from './useCustomModesStore'
import { isCustomModeId } from '../shared/ui/customModeTypes'
import {
  customModeDefinitionToRuntime,
  type CustomModeRuntimeConfig,
} from '../shared/ui/customModeRuntime'

export type { CustomModeRuntimeConfig } from '../shared/ui/customModeRuntime'

export function getActiveCustomModeRuntime(): CustomModeRuntimeConfig | null {
  const mode = useUIStore.getState().mode
  if (!isCustomModeId(mode)) return null
  const def = useCustomModesStore.getState().getById(mode)
  if (!def) return null
  return customModeDefinitionToRuntime(def)
}

export function useActiveCustomModeRuntime(): CustomModeRuntimeConfig | null {
  const mode = useUIStore((s) => s.mode)
  const modes = useCustomModesStore((s) => s.modes)
  return useMemo(() => {
    if (!isCustomModeId(mode)) return null
    const def = modes.find((m) => m.id === mode)
    if (!def) return null
    return customModeDefinitionToRuntime(def)
  }, [mode, modes])
}

/**
 * Resolves the LLM model id for the active custom automation.
 * If the automation has a non-empty `modelName`, that overrides WR Chat’s picker.
 * If `modelName` is empty, returns the current WR Chat selection (`fallbackRef` / `fallbackState`).
 */
export function getEffectiveLlmModelNameForActiveMode(
  fallbackRef: string,
  fallbackState: string,
): string {
  const rt = getActiveCustomModeRuntime()
  const override = rt?.modelName?.trim()
  if (override) return override
  return (fallbackRef || fallbackState || '').trim()
}
