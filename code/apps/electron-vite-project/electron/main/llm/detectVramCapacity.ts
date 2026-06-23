/**
 * Runtime VRAM / RAM capacity estimate for adaptive model residency (batch-04).
 * Conservative — under-estimates rather than risk OOM.
 */

import os from 'os'
import { hardwareService } from './hardware'

const OLLAMA_TAGS = 'http://127.0.0.1:11434/api/tags'
const DEFAULT_UNKNOWN_MODEL_GB = 4
const MEMORY_HEADROOM = 0.75
const MODEL_OVERHEAD = 1.15

export type VramCapacityEstimate = {
  availableMemoryGb: number
  source: 'gpu_vram' | 'system_ram'
  gpuAvailable: boolean
}

export async function estimateAvailableModelMemoryGb(): Promise<VramCapacityEstimate> {
  const hw = await hardwareService.detect()
  if (hw.gpuAvailable && typeof hw.gpuVramGb === 'number' && hw.gpuVramGb > 0) {
    return {
      availableMemoryGb: hw.gpuVramGb * MEMORY_HEADROOM,
      source: 'gpu_vram',
      gpuAvailable: true,
    }
  }
  const freeRamGb = os.freemem() / 1024 ** 3
  return {
    availableMemoryGb: Math.min(freeRamGb * 0.4, 12),
    source: 'system_ram',
    gpuAvailable: false,
  }
}

export async function fetchOllamaModelSizeBytesByName(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const res = await fetch(OLLAMA_TAGS, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return out
    const data = (await res.json()) as { models?: Array<{ name?: string; size?: number }> }
    for (const m of data.models ?? []) {
      const name = m.name?.trim()
      if (!name || typeof m.size !== 'number' || m.size <= 0) continue
      out.set(name, m.size)
    }
  } catch {
    /* best effort */
  }
  return out
}

function modelSizeGb(modelId: string, sizes: Map<string, number>): number {
  const bytes = sizes.get(modelId)
  if (typeof bytes === 'number' && bytes > 0) return bytes / 1024 ** 3
  return DEFAULT_UNKNOWN_MODEL_GB
}

/**
 * Estimate how many local models can stay resident at once (conservative).
 * Returns 1 or 2 — product caps two-resident strategy at 2.
 */
export async function estimateMaxResidentModels(opts: {
  defaultModelId?: string
  extraModelIds?: string[]
} = {}): Promise<number> {
  const { availableMemoryGb } = await estimateAvailableModelMemoryGb()
  const sizes = await fetchOllamaModelSizeBytesByName()

  const ids = new Set<string>()
  const defaultId = opts.defaultModelId?.trim()
  if (defaultId) ids.add(defaultId)
  for (const id of opts.extraModelIds ?? []) {
    const t = id?.trim()
    if (t) ids.add(t)
  }

  try {
    const { listModes } = await import('../customModes/customModesStore')
    for (const mode of listModes()) {
      const name = mode.modelName?.trim()
      if (name) ids.add(name)
    }
  } catch {
    /* store optional during early init */
  }

  if (ids.size === 0) return 1

  const defaultGb = defaultId ? modelSizeGb(defaultId, sizes) : DEFAULT_UNKNOWN_MODEL_GB
  const otherGbs = [...ids]
    .filter((id) => id !== defaultId)
    .map((id) => modelSizeGb(id, sizes))
  const largestOtherGb = otherGbs.length > 0 ? Math.max(...otherGbs) : defaultGb

  const pairNeedGb = (defaultGb + largestOtherGb) * MODEL_OVERHEAD
  if (pairNeedGb <= availableMemoryGb) return 2

  const singleLargestGb = Math.max(defaultGb, largestOtherGb) * MODEL_OVERHEAD
  if (singleLargestGb <= availableMemoryGb) return 1

  return 1
}
