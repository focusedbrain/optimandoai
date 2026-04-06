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

/** Prefer custom mode's model name when a custom mode is active; otherwise use picker state. */
export function getEffectiveLlmModelNameForActiveMode(
  fallbackRef: string,
  fallbackState: string,
): string {
  const rt = getActiveCustomModeRuntime()
  if (rt?.modelName?.trim()) return rt.modelName.trim()
  return (fallbackRef || fallbackState || '').trim()
}
