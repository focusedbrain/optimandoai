export type BeapRunAutomationWaitResult =
  | { ok: true; sessionKey?: string; executed?: string[] }
  | { ok: false; error: string; phase?: string }

type Pending = {
  resolve: (r: BeapRunAutomationWaitResult) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, Pending>()

export function registerBeapRunAutomationWaiter(
  requestId: string,
  timeoutMs: number,
): Promise<BeapRunAutomationWaitResult> {
  return new Promise((resolve) => {
    const existing = pending.get(requestId)
    if (existing) {
      clearTimeout(existing.timer)
    }
    const timer = setTimeout(() => {
      pending.delete(requestId)
      resolve({ ok: false, error: 'RUN_AUTOMATION_TIMEOUT', phase: 'timeout' })
    }, timeoutMs)
    pending.set(requestId, { resolve, timer })
  })
}

export function completeBeapRunAutomationWaiter(
  requestId: string,
  result: BeapRunAutomationWaitResult,
): void {
  const entry = pending.get(requestId)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(requestId)
  entry.resolve(result)
}
