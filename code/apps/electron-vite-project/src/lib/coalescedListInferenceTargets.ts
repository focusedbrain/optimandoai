/**
 * Per-handshake (and full-list) coalescing for `internalInference.listTargets` / `listInferenceTargets`.
 * Collapses React strict-mode / mount bursts so one user-visible trigger does not double IPC (and rate limits).
 */

const PROBE_COALESCE_TTL_MS = 1500

const inFlight = new Map<string, Promise<unknown>>()
const recentlyCompleted = new Map<string, { result: unknown; at: number }>()

export type CoalescedListInferenceInvokeOpts = {
  coalesceHandshakeId?: string
  /** Skip TTL cache (still joins an in-flight request for the same key). */
  bypassCache?: boolean
}

function cacheKey(opts?: CoalescedListInferenceInvokeOpts): string {
  const h = opts?.coalesceHandshakeId?.trim()
  return h && h.length > 0 ? h : '__all__'
}

function handshakeLogLabel(key: string): string {
  return key === '__all__' ? '(all)' : key
}

/** @internal Vitest only */
export function resetCoalescedListInferenceTargetsForTests(): void {
  inFlight.clear()
  recentlyCompleted.clear()
}

/**
 * Single-flight + short TTL replay for list-targets IPC. Passes only `{ coalesceHandshakeId }` through to `listFn`.
 */
export function coalescedListInferenceTargetsInvoke(
  listFn: (opts?: { coalesceHandshakeId?: string }) => Promise<unknown>,
  opts?: CoalescedListInferenceInvokeOpts,
): Promise<unknown> {
  const key = cacheKey(opts)
  const bypassCache = opts?.bypassCache === true

  if (!bypassCache) {
    const cached = recentlyCompleted.get(key)
    if (cached && Date.now() - cached.at < PROBE_COALESCE_TTL_MS) {
      const age = Date.now() - cached.at
      console.log(
        `[HOST_INFERENCE_TARGETS] probe_coalesced handshake=${handshakeLogLabel(key)} age_ms=${age}`,
      )
      return Promise.resolve(cached.result)
    }
  }

  const existing = inFlight.get(key)
  if (existing) {
    console.log(`[HOST_INFERENCE_TARGETS] probe_joined handshake=${handshakeLogLabel(key)}`)
    return existing
  }

  const ipcArg =
    opts?.coalesceHandshakeId != null && String(opts.coalesceHandshakeId).trim()
      ? { coalesceHandshakeId: String(opts.coalesceHandshakeId).trim() }
      : undefined

  const p = listFn(ipcArg)
    .then((result) => {
      recentlyCompleted.set(key, { result, at: Date.now() })
      return result
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, p)
  return p
}
