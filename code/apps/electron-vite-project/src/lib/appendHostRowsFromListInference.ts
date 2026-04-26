import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import { coalescedListInferenceTargetsInvoke } from './coalescedListInferenceTargets'
import type { InferenceTargetRefreshReason } from './inferenceTargetRefreshLog'
import { orderModelsLocalHostCloud, mapHostTargetsToGavModelEntries } from './modelSelectorMerge'

export type HostModelRow = {
  type?: string
  id: string
}

/**
 * After `handshake:getAvailableModels`, re-run the same `internal-inference:listTargets` call the main
 * process uses (no llm getStatus) and merge any missing `host_internal` rows (available or disabled).
 * Does not require local Ollama models: `models: []` still triggers a probe when `!hasHost` (see `shouldProbe`).
 * Host rows are not filtered by `provider === 'ollama'`.
 * When `force` is true or `reason === 'manual_refresh'`, calls `listTargets` and **replaces** existing
 * `host_internal` model rows with fresh targets (re-reads ledger `p2p_endpoint`, validation, and capabilities).
 */
export async function appendHostRowsFromListInference<T extends HostModelRow>(options: {
  reason: InferenceTargetRefreshReason | undefined
  models: T[]
  force?: boolean
  /**
   * True when `handshake:getAvailableModels` returned `host_internal` in `models[]` but
   * `hostInferenceTargets` (parallel IPC) was empty — re-run `listTargets` to sync
   * `gav` + the Host hook, same as a missing Host row.
   */
  gavIpcFromHandshakeEmpty?: boolean
}): Promise<{ models: T[]; gav: HostInferenceTargetRow[] }> {
  const { reason, models, force, gavIpcFromHandshakeEmpty } = options
  const hasHost = models.some((m) => m.type === 'host_internal')
  const shouldReplaceHostRows = Boolean(force) || reason === 'manual_refresh'
  const shouldProbe =
    Boolean(force) ||
    reason === 'manual_refresh' ||
    !hasHost ||
    (Boolean(hasHost) && Boolean(gavIpcFromHandshakeEmpty))
  if (!shouldProbe) {
    return { models, gav: [] }
  }
  const inf = (window as unknown as {
    internalInference?: {
      listTargets?: (opts?: { coalesceHandshakeId?: string }) => Promise<unknown>
      listInferenceTargets?: (opts?: { coalesceHandshakeId?: string }) => Promise<unknown>
    }
  }).internalInference
  const listFn = typeof inf?.listTargets === 'function' ? inf.listTargets : inf?.listInferenceTargets
  if (typeof listFn !== 'function') {
    return { models, gav: [] }
  }
  try {
    const hostRow = models.find((m) => m.type === 'host_internal') as { handshake_id?: string } | undefined
    const hid = typeof hostRow?.handshake_id === 'string' ? hostRow.handshake_id.trim() : ''
    const bypassCache = shouldReplaceHostRows
    const r = (await coalescedListInferenceTargetsInvoke(listFn, {
      coalesceHandshakeId: hid || undefined,
      bypassCache,
    })) as {
      ok?: boolean
      targets?: HostInferenceTargetRow[]
    }
    if (!r?.ok || !Array.isArray(r.targets) || r.targets.length === 0) {
      return { models, gav: [] }
    }
    const gav = r.targets
    const fromTargets = mapHostTargetsToGavModelEntries(gav) as unknown as T[]
    if (shouldReplaceHostRows) {
      const withoutHost = models.filter((m) => m.type !== 'host_internal') as T[]
      const next = orderModelsLocalHostCloud([...withoutHost, ...fromTargets]) as T[]
      return { models: next, gav }
    }
    const seen = new Set(models.map((m) => m.id))
    const next: T[] = [...models]
    for (const row of fromTargets) {
      if (!seen.has(row.id)) {
        next.push(row)
        seen.add(row.id)
      }
    }
    return { models: orderModelsLocalHostCloud(next) as T[], gav }
  } catch {
    return { models, gav: [] }
  }
}
