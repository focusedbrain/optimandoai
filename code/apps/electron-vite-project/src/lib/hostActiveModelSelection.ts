import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import { hostInferenceTargetMenuSelectable } from './hostAiTargetConnectionPresentation'

export type HostAiSelectionSource =
  | 'user'
  | 'host_active'
  | 'persisted'
  | 'fallback_first_available'

export function getHostActiveModelIdFromTargets(
  targets: readonly HostInferenceTargetRow[] | undefined,
): string | null {
  const rows = Array.isArray(targets) ? targets : []
  const activeRow =
    rows.find((t) => t.isHostActiveModel === true && hostInferenceTargetMenuSelectable(t)) ??
    rows.find((t) => {
      const active = String(t.hostActiveModel ?? '').trim()
      return (
        active.length > 0 &&
        hostInferenceTargetMenuSelectable(t) &&
        (String(t.model ?? '').trim() === active || String(t.model_id ?? '').trim() === active)
      )
    })
  return activeRow?.id?.trim() || null
}

export function getHostActiveModelIdFromModels(
  models: ReadonlyArray<{
    id: string
    type?: string
    hostTargetAvailable?: boolean
    isHostActiveModel?: boolean
  }> | undefined,
): string | null {
  const rows = Array.isArray(models) ? models : []
  const active = rows.find(
    (m) => m.type === 'host_internal' && m.hostTargetAvailable !== false && m.isHostActiveModel === true,
  )
  return active?.id?.trim() || null
}

export function getFirstAvailableHostModelId(
  models: ReadonlyArray<{ id: string; type?: string; hostTargetAvailable?: boolean }> | undefined,
  targets: readonly HostInferenceTargetRow[] | undefined,
): string | null {
  const fromModels = (Array.isArray(models) ? models : []).find(
    (m) => m.type === 'host_internal' && m.hostTargetAvailable !== false,
  )?.id
  if (fromModels?.trim()) return fromModels.trim()
  const fromTargets = (Array.isArray(targets) ? targets : []).find((t) => hostInferenceTargetMenuSelectable(t))?.id
  return fromTargets?.trim() || null
}
