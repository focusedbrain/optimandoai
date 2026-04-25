import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import type { InferenceTargetRefreshReason } from './inferenceTargetRefreshLog'
import { appendHostRowsFromListInference } from './appendHostRowsFromListInference'
import { orderModelsLocalHostCloud, mapHostTargetsToGavModelEntries } from './modelSelectorMerge'
import { HOST_AI_SELECTOR_ICON_CLASS } from './hostAiSelectorCopy'

/**
 * Merged `handshake:getAvailableModels` + `internal-inference:listTargets` (Sandbox) — one pipeline for
 * top chat (HybridSearch) and WR Chat so both selectors refresh the same way. Never uses `llm.getStatus`.
 */
export type SelectorAvailableModel =
  | {
      id: string
      name: string
      provider: string
      type: 'local' | 'cloud'
    }
  | {
      id: string
      name: string
      provider: 'host_internal'
      type: 'host_internal'
      displayTitle: string
      displaySubtitle: string
      hostTargetAvailable: boolean
      hostSelectorState?: 'available' | 'checking' | 'unavailable'
    }

export type FetchSelectorModelListResult = {
  result: unknown
  withHost: {
    success?: boolean
    models?: unknown[]
    hostInferenceTargets?: HostInferenceTargetRow[]
    inferenceRefreshMeta?: { hadCapabilitiesProbed?: boolean }
  }
  models: SelectorAvailableModel[]
  /** What to pass to `useSandboxHostInference` gav (same as HybridSearch `gavHostTargets`). */
  gavForHook: HostInferenceTargetRow[]
  path: 'gav_success' | 'gav_host_only' | 'list_fallback' | 'empty'
}

/**
 * Unifies top bar + WR Chat: `handshake:getAvailableModels`, then (Sandbox) `appendHostRowsFromListInference`
 * (same as `internal-inference:listTargets` merge in main).
 */
export async function fetchSelectorModelListFromHostDiscovery(options: {
  reason: InferenceTargetRefreshReason | undefined
  force?: boolean
  orchIsSandbox: boolean
}): Promise<FetchSelectorModelListResult> {
  const { reason, force, orchIsSandbox } = options
  const result = await window.handshakeView?.getAvailableModels?.()
  const withHost = (result && typeof result === 'object' ? result : {}) as FetchSelectorModelListResult['withHost']
  const hostTargets = Array.isArray(withHost.hostInferenceTargets) ? withHost.hostInferenceTargets : []
  const listInferenceOpts = {
    reason,
    force,
    gavIpcFromHandshakeEmpty: hostTargets.length === 0,
  }

  const success = withHost && (withHost as { success?: boolean }).success === true
  if (success) {
    const rawModels = Array.isArray((withHost as { models?: unknown[] }).models)
      ? (withHost as { models: unknown[] }).models
      : []
    let models = orderModelsLocalHostCloud(rawModels as SelectorAvailableModel[])
    if (hostTargets.length > 0) {
      const fromTargets = mapHostTargetsToGavModelEntries(hostTargets) as unknown as SelectorAvailableModel[]
      const seen = new Set(models.map((m) => m.id))
      for (const row of fromTargets) {
        if (!seen.has(row.id)) {
          models.push(row)
          seen.add(row.id)
        }
      }
      models = orderModelsLocalHostCloud(models)
    }
    let gavForHook: HostInferenceTargetRow[] = hostTargets
    if (orchIsSandbox) {
      const extra = await appendHostRowsFromListInference<SelectorAvailableModel>({ ...listInferenceOpts, models })
      if (extra.gav.length > 0) {
        gavForHook = extra.gav
        models = extra.models
      }
    }
    return { result, withHost, models, gavForHook, path: 'gav_success' }
  }
  if (hostTargets.length > 0) {
    let models = orderModelsLocalHostCloud(
      mapHostTargetsToGavModelEntries(hostTargets) as unknown as SelectorAvailableModel[],
    )
    let gavForHook: HostInferenceTargetRow[] = hostTargets
    if (orchIsSandbox) {
      const extra = await appendHostRowsFromListInference<SelectorAvailableModel>({ ...listInferenceOpts, models })
      if (extra.gav.length > 0) {
        gavForHook = extra.gav
        models = extra.models
      }
    }
    return { result, withHost, models, gavForHook, path: 'gav_host_only' }
  }
  if (orchIsSandbox) {
    const extra = await appendHostRowsFromListInference<SelectorAvailableModel>({ ...listInferenceOpts, models: [] })
    if (extra.gav.length > 0) {
      return {
        result,
        withHost,
        models: extra.models,
        gavForHook: extra.gav,
        path: 'list_fallback',
      }
    }
  }
  return {
    result,
    withHost,
    models: [],
    gavForHook: hostTargets,
    path: 'empty',
  }
}

/**
 * Map unified selector models into WR `PopupChatView` model rows (local → host → cloud order preserved
 * in `models[]`).
 */
export function wrChatModelOptionsFromSelectorModels(models: SelectorAvailableModel[]): Array<{
  name: string
  size?: string
  displayTitle?: string
  subtitle?: string
  hostAi?: boolean
  hostAvailable?: boolean
  hostTargetChecking?: boolean
  hostIconClass?: string
  section?: 'local' | 'host' | 'cloud'
}> {
  return models.map((m) => {
    switch (m.type) {
      case 'local':
      case 'cloud':
        return {
          name: m.id,
          displayTitle: m.name,
          section: m.type,
        }
      case 'host_internal': {
        const sel = m.hostSelectorState ?? (m.hostTargetAvailable ? 'available' : 'unavailable')
        return {
          name: m.id,
          displayTitle: m.displayTitle,
          subtitle: m.displaySubtitle,
          hostAi: true,
          hostAvailable: m.hostTargetAvailable,
          hostTargetChecking: sel === 'checking',
          hostIconClass: HOST_AI_SELECTOR_ICON_CLASS,
          section: 'host' as const,
        }
      }
    }
  })
}
