/**
 * Top chat + WR Chat: consistent ordering for `handshake:getAvailableModels` rows.
 * finalOptions = [...local, ...host_internal, ...cloud] — never drop host when local is empty.
 */

import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'

export function orderModelsLocalHostCloud<T extends { type?: string }>(models: T[]): T[] {
  const local = models.filter((m) => m?.type === 'local')
  const host = models.filter((m) => m?.type === 'host_internal')
  const cloud = models.filter((m) => m?.type === 'cloud')
  const rest = models.filter(
    (m) => m?.type !== 'local' && m?.type !== 'host_internal' && m?.type !== 'cloud',
  )
  return [...local, ...host, ...cloud, ...rest]
}

/** Map IPC `hostInferenceTargets` (full rows) to the same host_internal shape as `models[]` in HybridSearch. */
export function mapHostTargetsToGavModelEntries(targets: HostInferenceTargetRow[]): Array<{
  id: string
  name: string
  provider: 'host_internal'
  type: 'host_internal'
  displayTitle: string
  displaySubtitle: string
  hostTargetAvailable: boolean
  hostSelectorState?: 'available' | 'checking' | 'unavailable'
  p2pUiPhase?: string
}> {
  return targets
    .filter((t) => t?.kind === 'host_internal' && typeof t.id === 'string' && t.id.length > 0)
    .map((t) => {
      const st =
        t.hostSelectorState ??
        t.host_selector_state ??
        (t.unavailable_reason === 'CHECKING_CAPABILITIES' || t.availability === 'checking_host'
          ? 'checking'
          : t.available
            ? 'available'
            : 'unavailable')
      const displayTitle = (t.displayTitle ?? t.display_label ?? t.label ?? 'Host AI').trim() || 'Host AI'
      const displaySubtitle = (t.displaySubtitle ?? t.secondary_label ?? '').trim()
      return {
        id: t.id,
        name: displayTitle,
        provider: 'host_internal' as const,
        type: 'host_internal' as const,
        displayTitle,
        displaySubtitle,
        hostTargetAvailable: t.available === true,
        hostSelectorState: st,
        p2pUiPhase: t.p2pUiPhase,
      }
    })
}
