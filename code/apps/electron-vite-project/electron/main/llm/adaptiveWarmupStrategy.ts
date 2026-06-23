/**
 * Adaptive warmup strategy — VRAM-detected two-resident vs warm-on-trigger (batch-04).
 */

import { estimateMaxResidentModels } from './detectVramCapacity'
import { resolveAiExecutionContextForLlm } from './resolveAiExecutionContext'

export type WarmupStrategyKind = 'two_resident' | 'warm_on_trigger'

export type WarmupStrategy = {
  kind: WarmupStrategyKind
  maxResident: number
}

const L = '[WARMUP]'

let cachedStrategy: WarmupStrategy | null = null

/** @internal tests */
export function _resetAdaptiveWarmupStrategyForTests(): void {
  cachedStrategy = null
}

export function getCachedWarmupStrategy(): WarmupStrategy | null {
  return cachedStrategy
}

export function getEffectiveMaxResidentModels(): number {
  return cachedStrategy?.maxResident ?? 1
}

export function getAdaptiveKeepAlive(): string {
  if (cachedStrategy?.kind === 'two_resident') return '15m'
  return '2m'
}

export async function resolveAdaptiveWarmupStrategy(): Promise<WarmupStrategy> {
  if (cachedStrategy) return cachedStrategy

  let defaultModelId: string | undefined
  try {
    const resolved = await resolveAiExecutionContextForLlm()
    if (resolved.ok && resolved.ctx.lane === 'local') {
      defaultModelId = resolved.ctx.model?.trim() || undefined
    }
  } catch {
    /* best effort */
  }

  const estimated = await estimateMaxResidentModels({ defaultModelId })
  const maxResident = estimated >= 2 ? 2 : 1
  const kind: WarmupStrategyKind = maxResident >= 2 ? 'two_resident' : 'warm_on_trigger'
  cachedStrategy = { kind, maxResident }
  console.log(`${L} strategy=${kind} maxResident=${maxResident}`)
  return cachedStrategy
}
