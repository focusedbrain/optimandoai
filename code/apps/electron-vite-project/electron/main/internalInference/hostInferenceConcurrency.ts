import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { InternalInferenceErrorCode } from './errors'

let active = 0

export function tryAcquireHostInferenceSlot(): { ok: true; release: () => void } | { ok: false; code: string } {
  const max = getHostInternalInferencePolicy().maxConcurrent
  if (active >= max) {
    return { ok: false, code: InternalInferenceErrorCode.PROVIDER_BUSY }
  }
  active += 1
  let released = false
  return {
    ok: true,
    release: () => {
      if (released) return
      released = true
      active = Math.max(0, active - 1)
    },
  }
}

export function getActiveInternalInferenceCount(): number {
  return active
}

/** @internal */
export function _resetConcurrencyForTests(): void {
  active = 0
}
