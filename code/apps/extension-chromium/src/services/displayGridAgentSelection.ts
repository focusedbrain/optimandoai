/**
 * Pick the first display grid (in array order) that has at least one slot whose agent box has provider/model configured.
 */

import type { AgentBox, DisplayGrid } from './processFlow'

function isProviderModelConfigured(box: AgentBox | undefined): boolean {
  if (!box) return false
  const p = typeof box.provider === 'string' ? box.provider.trim() : ''
  const m = typeof box.model === 'string' ? box.model.trim() : ''
  return p.length > 0 || m.length > 0
}

function boxForSlotNumber(agentBoxes: AgentBox[], boxNumber: number): AgentBox | undefined {
  return agentBoxes.find((b) => Number(b.boxNumber) === Number(boxNumber))
}

/**
 * Returns the first grid (by array index) that has at least one slot with min boxNumber among configured agents,
 * where "configured" means non-blank provider or model on the matching agent box.
 */
export function firstGridWithEarliestAgentSetup(
  grids: DisplayGrid[],
  agentBoxes: AgentBox[],
): DisplayGrid | null {
  if (!Array.isArray(grids) || grids.length === 0) return null

  for (const grid of grids) {
    const slots = grid.config?.slots
    if (!slots || typeof slots !== 'object') continue

    let minBox: number | null = null
    let hasConfigured = false

    for (const slot of Object.values(slots)) {
      if (!slot || typeof slot !== 'object') continue
      const bn = Number((slot as { boxNumber?: number }).boxNumber ?? NaN)
      if (!Number.isFinite(bn)) continue
      const box = boxForSlotNumber(agentBoxes, bn)
      if (!isProviderModelConfigured(box)) continue
      hasConfigured = true
      if (minBox === null || bn < minBox) minBox = bn
    }

    if (hasConfigured && minBox !== null) {
      return grid
    }
  }

  return null
}
