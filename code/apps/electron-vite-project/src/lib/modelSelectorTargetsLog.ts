/**
 * Dev / support logs for model selector composition (top dashboard chat + WR Chat dashboard). No prompt text.
 * Format: [MODEL_SELECTOR_TARGETS] … (see logModelSelectorTargets).
 */

const PREFIX = '[MODEL_SELECTOR_TARGETS]'

/** Keys that must never appear in logs (values stripped). */
const SECRET_KEY_RE = /(token|password|secret|authorization|bearer|counterparty_p2p|api[_-]?key)/i

function scrubValue(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (typeof v === 'string') {
    const t = v.length > 400 ? `${v.slice(0, 400)}…` : v
    return t
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.map((x) => scrubValue(x))
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = '[redacted]'
        continue
      }
      out[k] = scrubValue(o[k])
    }
    return out
  }
  return String(v)
}

export type ModelSelectorSurface = 'top' | 'wrchat'

export function logModelSelectorTargets(args: {
  /** Top bar = HybridSearch orchestrator chat; wrchat = WRChatDashboardView / PopupChatView. */
  selector: ModelSelectorSurface
  localCount: number
  hostCount: number
  finalCount: number
  /** Host inference rows or host_internal model entries (sanitized). */
  hostTargets: unknown
  /** Current selection (id string or small object; sanitized). */
  selected: unknown
}): void {
  const { selector, localCount, hostCount, finalCount, hostTargets, selected } = args
  console.log(`${PREFIX} host_count=${hostCount} final_count=${finalCount}`)
  console.log(
    `${PREFIX} selector=${selector} local_count=${localCount} host_count=${hostCount} final_count=${finalCount}`,
  )
  try {
    console.log(`${PREFIX} host_targets=${JSON.stringify(scrubValue(hostTargets))}`)
  } catch {
    console.log(`${PREFIX} host_targets=(unserializable)`)
  }
  try {
    console.log(`${PREFIX} selected=${JSON.stringify(scrubValue(selected))}`)
  } catch {
    console.log(`${PREFIX} selected=(unserializable)`)
  }
}
