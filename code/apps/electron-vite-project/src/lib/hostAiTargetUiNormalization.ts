/**
 * Stable semantic projection of Host inference rows — omit volatile telemetry (ttl, corr, timestamps)
 * before comparing snapshots to avoid pointless React updates / effect loops after polling IPC.
 */

import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'

type HostRowExtras = Pick<
  HostInferenceTargetRow,
  | 'host_device_id'
  | 'handshake_id'
  | 'trusted'
  | 'canChat'
  | 'canUseTopChatTools'
  | 'canUseOllamaDirect'
  | 'failureCode'
  | 'host_ai_target_status'
  | 'id'
>

/** Fields that must not leak into equality checks when present on mirrored objects. */
const VOLATILE_ROOT_KEYS = new Set([
  'ttl_remaining_ms',
  'last_seen_at',
  'corr',
  'chain',
  'timestamp',
  'timestamp_ms',
  'cacheTtlMs',
  'cached_at_ms',
])

function stripVolatileShallow(val: unknown): unknown {
  if (val === null || val === undefined) return val
  if (typeof val !== 'object' || Array.isArray(val)) return val
  const o = val as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (VOLATILE_ROOT_KEYS.has(k)) continue
    next[k] = v
  }
  return next
}

/** Per user spec — one row covers one IPC/GAV Host internal target (model rows share handshake). */
export function normalizeHostAiTargetForUi(
  target: HostInferenceTargetRow & {
    peer_host_device_id?: string
    /** Some IPC paths send snake_case peer id. */
    status?: unknown
    route_kind?: string
    routeKind?: string
    models?: unknown[]
    models_count?: number
  },
): {
  /** Stable handshake key (duplicate model rows collapse only if you also fingerprint model below). */
  id: string
  canonicalRowId: string
  peerDeviceId: string
  status: string | undefined
  trusted: boolean | undefined
  canChat: boolean | undefined
  canUseTopChatTools: boolean | undefined
  canUseOllamaDirect: boolean | undefined
  failureCode: string | null | undefined
  modelsCount: number
  routeKind: string | null
  modelFingerprint: string
} {
  const peer =
    (target as { peer_host_device_id?: string }).peer_host_device_id?.trim() ||
    target.host_device_id?.trim() ||
    ''
  const handshake = String(target.handshake_id ?? '').trim()
  const modelFp = [
    String(target.model_id ?? ''),
    String(target.model ?? ''),
    String(target.id ?? ''),
  ]
    .map((s) => s.trim())
    .join('\u241e')

  const st =
    typeof (target as { status?: unknown }).status !== 'undefined'
      ? String((target as { status?: unknown }).status)
      : typeof target.host_ai_target_status !== 'undefined'
        ? String(target.host_ai_target_status)
        : undefined

  const rk =
    typeof (target as { route_kind?: string }).route_kind === 'string'
      ? String((target as { route_kind?: string }).route_kind).trim()
      : typeof (target as { routeKind?: unknown }).routeKind === 'string'
        ? String((target as { routeKind?: unknown }).routeKind).trim()
        : null

  let modelsCount =
    typeof (target as { models_count?: number }).models_count === 'number'
      ? (target as { models_count: number }).models_count
      : 0
  const arr = (target as { models?: unknown[] }).models
  if (Array.isArray(arr)) modelsCount = arr.length

  return {
    id: handshake || peer || 'unknown-handshake',
    canonicalRowId: String(target.id ?? `${handshake}\u241e${modelFp}`),
    peerDeviceId: peer,
    status: st,
    trusted: (target as HostRowExtras).trusted,
    canChat: target.canChat,
    canUseTopChatTools: target.canUseTopChatTools,
    canUseOllamaDirect: target.canUseOllamaDirect,
    failureCode: target.failureCode ?? null,
    modelsCount,
    routeKind: rk && rk.length > 0 ? rk : null,
    modelFingerprint: modelFp,
  }
}

/** Lexicographically stable JSON string — safe for semantic equality across polls. */
export function serializeNormalizedHostAiTargetListUi(
  targets: HostInferenceTargetRow[] | readonly HostInferenceTargetRow[],
): string {
  const projected = [...targets].map((t) => normalizeHostAiTargetForUi(t as HostInferenceTargetRow)).sort((a, b) => {
    const c = a.canonicalRowId.localeCompare(b.canonicalRowId)
    if (c !== 0) return c
    return (a.status ?? '').localeCompare(b.status ?? '')
  })
  return JSON.stringify(projected.map((p) => stripVolatileShallow(p)))
}

export function areNormalizedHostAiTargetListsEqual(
  a: HostInferenceTargetRow[] | readonly HostInferenceTargetRow[],
  b: HostInferenceTargetRow[] | readonly HostInferenceTargetRow[],
): boolean {
  return serializeNormalizedHostAiTargetListUi(a) === serializeNormalizedHostAiTargetListUi(b)
}

/** Host + local + cloud merged selector rows — drop volatile fields for stable snapshots. */
export function serializeMergedSelectorModelsForStableUi(models: unknown[] | readonly unknown[]): string {
  const rows = [...models].map((raw) => {
    const m = raw as Record<string, unknown>
    const ty = typeof m?.type === 'string' ? m.type : ''
    if (ty === 'host_internal') {
      return stripVolatileShallow({
        id: m.id,
        type: ty,
        name: m.name,
        hostTargetAvailable: m.hostTargetAvailable,
        hostSelectorState: m.hostSelectorState ?? m.host_selector_state,
        host_ai_target_status: m.host_ai_target_status ?? null,
        displayTitle: m.displayTitle ?? null,
        displaySubtitle: m.displaySubtitle ?? null,
        p2pUiPhase: m.p2pUiPhase ?? null,
        canChat: (m as { canChat?: unknown }).canChat,
        execution_transport: (m as { execution_transport?: unknown }).execution_transport,
      })
    }
    return stripVolatileShallow({
      id: m.id,
      type: ty,
      name: m.name,
      provider: (m as { provider?: unknown }).provider,
    })
  })
  rows.sort((a: unknown, b: unknown) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b), undefined, { numeric: true }),
  )
  return JSON.stringify(rows)
}
