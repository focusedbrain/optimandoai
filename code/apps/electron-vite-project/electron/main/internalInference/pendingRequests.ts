import { InternalInferenceErrorCode } from './errors'

const DEFAULT_TIMEOUT_MS = 30_000

export type PendingResult =
  | { kind: 'result'; output: string; model?: string; duration_ms?: number }
  | { kind: 'error'; code: string; message: string }

const pending = new Map<
  string,
  {
    resolve: (v: PendingResult) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
>()

export function registerInternalInferenceRequest(requestId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PendingResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(requestId)) {
        const err = new Error(InternalInferenceErrorCode.REQUEST_TIMEOUT)
        ;(err as any).code = InternalInferenceErrorCode.REQUEST_TIMEOUT
        reject(err)
      }
    }, timeoutMs)
    pending.set(requestId, { resolve, reject, timer })
  })
}

export function resolveInternalInferenceByRequestId(requestId: string, value: PendingResult): boolean {
  const entry = pending.get(requestId)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(requestId)
  entry.resolve(value)
  return true
}

export function rejectInternalInferenceByRequestId(requestId: string, err: Error): boolean {
  const entry = pending.get(requestId)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(requestId)
  entry.reject(err)
  return true
}

/** For tests: clear without resolving */
export function _resetPendingForTests(): void {
  for (const [, v] of pending) {
    try {
      clearTimeout(v.timer)
    } catch { /* */ }
  }
  pending.clear()
}
